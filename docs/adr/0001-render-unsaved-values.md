# ADR 0001: Render unsaved editor values with render sessions and an overlaid published model

- **Status:** Accepted
- **Date:** 2026-09-23
- **Issue:** #9 (spike). Carried forward by #15 (render endpoint) and #18 (live re-render).

## Context

The visual editor's canvas must show the page as the editor changes it, **before** they save. Umbraco's preview only renders saved drafts. The rendering has to use the site's real templates, partials, view components and ModelsBuilder models, because the product promise is that it works with any existing document model setup.

## Decision

Render the page through Umbraco's **normal front-end pipeline**, using a document model built in memory. The model is the document's saved draft, with properties replaced by the editor's unsaved workspace values.

1. **Render session.** The backoffice POSTs the workspace's current values to `POST /umbraco/arjovisualeditor/api/v1/render-session`:
   - the body contains `documentKey`, `culture`, `segment`, and `values[]` of `{alias, culture, segment, value}`;
   - the values are in the same editor format the workspace holds and the Management API accepts.

   The endpoint:
   - requires backoffice auth and Browse permission on the document (`ContentPermissionByResource`);
   - returns 404 if the document has no draft;
   - stores the snapshot under a random token (in-memory, 10-minute sliding expiry);
   - returns `/__visual-editor/render/{token}`.
2. **Content finder.** `RenderSessionContentFinder` sits first in the content finder chain and serves that URL. It builds the overlaid content, sets the culture, and hands off to Umbraco's own routing and rendering: template resolution, `RenderController`, view, layout and partials. The iframe loads it as an ordinary same-origin page.
3. **Overlaid model** (`OverlayContentBuilder`), which runs the same value pipeline as a real save and publish:
   - **Base:** the document's draft `IPublishedContent`, from `IPublishedContentCache.GetByIdAsync(key, preview: true)`.
   - **Stored format:** each posted value is converted with the property editor's own `IDataValueEditor.FromEditor(...)`, exactly as saving does.
   - **`OverlayPublishedProperty`** exposes that value as the property's source and runs `IPublishedPropertyType.ConvertSourceToInter` → `ConvertInterToObject`, which are the normal value converters: block editors, rich text, media pickers and so on.
     - **Culture:** it resolves the culture and segment through `IVariationContextAccessor.ContextualizeVariation`, as Umbraco's own properties do. Views call `Value("x")` without a culture.
     - **`HasValue`:** checks Source, then Inter, then Object, in Umbraco's order. The rich text converter throws if asked about Object first.
   - **Wrapper:** `OverlayPublishedContent : PublishedContentWrapped` swaps in the overridden properties.
   - **Typed model:** the result goes through `IPublishedModelFactory.CreateModel`, so strongly typed views such as `UmbracoViewPage<Home>` still bind.

Structural edits (adding, removing, reordering or nesting blocks) need no special handling, because a block property's whole value is replaced and re-converted.

## Evidence (prototype on the Test Site)

| Check | Result |
|---|---|
| Invariant textstring change on Home renders; live `/` and the stored draft are unchanged | ✓ |
| da-DK variant: title, rich text, Single Block content, and an image caption inside a nested Block Grid area | ✓ |
| en-US render unaffected by da-DK edits | ✓ |
| Reordered Block Grid items render in the new order | ✓ |
| A brand-new, never-saved block renders | ✓ |
| Unknown document → 404; unknown or expired token → 404 | ✓ |
| Re-render time: POST session + GET page, 10 runs on the playground (all property shapes) | **~17 ms median, 18 ms max**, against a 300 ms target |
| Baseline: normal GET of the same page | ~9 ms |

The timings are for a local dev machine and a small page. They show the overlay adds roughly 10 ms. They don't predict production numbers for heavy pages.

## Options considered

1. **Auto-save a draft, then use Umbraco preview.** Rejected:
   - It creates a content version per keystroke-batch, which pollutes history and rollback.
   - It doesn't work for users who can view but not save.
   - It fires save notifications and webhooks.
   - It's slower.
2. **Use HybridCache's `ICacheNodeFactory`/`IPublishedContentFactory` to build published content from an unsaved `IContent`.** This would give identical fidelity, including names and dates, but both are `internal`. Using them via reflection would break silently on upgrades.
3. **Render the view to a string inside the Management API controller** (`IRazorViewEngine`, a hand-built `ViewContext`, and `PublishedRequest`), then send the HTML to an iframe `srcdoc`. Rejected:
   - We would have to rebuild Umbraco's routing state by hand (`UmbracoRouteValues`, the published request, culture and domain).
   - `srcdoc` pages have an opaque origin and no real URL, so relative links, cookies, `fetch` calls and scripts that read `location` behave differently from the live site.
   - The render-session URL gets all of this for free.
4. **Hybrid (overlay for values, full reload for structural changes).** Unnecessary. Structural changes are just values (see above).

## Consequences and follow-ups

- **Renames are not overlaid (#15).** The page's name, and per-culture names, come from the stored draft, because names aren't properties. `OverlayPublishedContent` should override `Name`/`Cultures` from the workspace's variant names.
- **Never-saved documents can't render (#15).** A document created in the workspace but not yet saved has no draft to overlay, so the endpoint returns 404. Options: save once before entering visual mode, which is the simplest, or build a synthetic base from the content type.
- **Token URL is a bearer capability (#34).** The render URL is a normal front-end request with no backoffice auth, so anyone holding the token can view that unsaved snapshot for up to 10 minutes. The token is a random GUID bound to one document and snapshot. Hardening for the security review:
  - `Cache-Control: no-store` and `X-Robots-Tag: noindex` on render responses;
  - binding the session to the creating user (the key is already recorded) via a same-site cookie;
  - shorter expiry.
- **In-memory store is single-server (#15).** A load-balanced backoffice needs `IDistributedCache` or sticky sessions.
- **Re-rendering strategy (#18).** Each change posts the full value set, which is simple and stateless. If payloads get large, send only changed properties and merge them over the previous session.
- **Other nodes render as published.** Navigation, `Children()` and pickers resolve other content from the published cache. That's right for editing one page. Showing *other pages'* drafts would need preview mode for the render request.
- **Page output caching.** Clean's `CachedPartialAsync` navigation is cached by partial name, so it won't reflect an unsaved rename of this page. `#38` should document caching behaviour for other sites.
- **Delivery API values are not overlaid.** `GetDeliveryApiValue` falls back to the stored value. It isn't used when rendering Razor.
- **Markers.** How the rendered DOM maps back to properties and blocks is decided separately in #10. The overlay is where edit-mode markers can be injected, because it already controls property values for this request only.
