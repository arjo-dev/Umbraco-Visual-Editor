# ADR 0002: Map rendered DOM to properties and blocks with edit-mode markers

- **Status:** Accepted
- **Date:** 2026-09-23
- **Issue:** #10 (spike). Builds on [ADR 0001](0001-render-unsaved-values.md). Used by #12 (protocol), #15 (render endpoint), #17 (canvas runtime), #20 (inline text) and #24 (block markers).

## Context

The canvas has to know which DOM elements show which property, or which block, so it can select, edit and drag them. The README promises this works with **any existing document model setup**, so templates shouldn't have to change. Markers must appear only in edit-mode renders and never on the live site.

## Decision

The server emits three kinds of marker, only during render-session requests. It works this out from the published models and block partials, not from the site's templates. The page also gets a JSON **manifest** that maps marker ids to what they point at, and a runtime in the page resolves the markers to elements.

### Where markers come from

| Marker | Emitted by | Format |
|---|---|---|
| **Plain text** (Textstring, Textarea) | `MarkedProperty` prefixes the converted string with an invisible id | "Stega": `U+2063`, the id in base 4 using `U+200B U+200C U+200D U+2060`, then `U+2063`. It survives Razor HTML-encoding and works inside attribute values. |
| **Rich text** | `MarkedProperty` wraps the `IHtmlEncodedString` | `<!--uve:p:ID-->…<!--/uve:p:ID-->` |
| **Blocks** (Block List, Block Grid, Single Block) | `BlockMarkingViewEngine` wraps any **partial whose model is `IBlockReference`**, whatever the view is called | `<!--uve:b:ID-->…<!--/uve:b:ID-->` |

- **How properties get wrapped:** a decorator around the site's `IPublishedModelFactory` wraps the edited document, and each of its blocks' elements, *before* the site's ModelsBuilder model is applied. Umbraco's block converters create elements through that factory, so properties inside blocks are marked too.
- **InMemoryAuto keeps working:** the decorator implements `IAutoPublishedModelFactory` by delegation, so InMemoryAuto model reloading still works.
- **Edit mode only:** everything is gated on `EditModeRequest`, which only the render-session content finder sets. Live requests are untouched (verified: zero markers on `/playground/`).
- **Only this document's blocks:** blocks are marked only if their key appears in the edited document's values (`EditModeRequest.BlockKeys`, collected recursively through nested blocks and areas). Another page's blocks aren't marked, for example Clean's footer rendering Home's social icons.

### Manifest

`MarkerInjectionMiddleware` appends this before `</body>`:

```html
<script type="application/json" id="uve-markers">
{"documentKey":"…","culture":"en-US","markers":[
  {"id":1,"kind":"Property","ownerKey":"<document key>","ownerIsBlock":false,"alias":"title","culture":"en-US","editorAlias":"Umbraco.TextBox"},
  {"id":3,"kind":"Block","ownerKey":"<block content key>","ownerIsBlock":true, …},
  {"id":4,"kind":"Property","ownerKey":"<block content key>","ownerIsBlock":true,"alias":"headline", …}]}
</script>
```

Block markers carry only the block's **content key**, and properties inside blocks carry the block key as `ownerKey`. The backoffice finds the block by key in the document's block values, so the server doesn't need to know the path (property, then area, then nesting).

Render-session responses also get `Cache-Control: no-store` and `X-Robots-Tag: noindex`.

### Runtime (`Client/src/canvas/markers.ts`)

`resolveMarkers(manifest)` works across the whole document, `<head>` included:

1. **Text nodes:** finds the invisible ids. The target is the parent element. It then strips the ids.
2. **Attributes:** does the same, recording the attribute name.
3. **Comment pairs:** targets the elements between a start comment and its end comment.
   - Nested partials for the same block reuse the id, and the outermost pair wins.
   - With Block Grid's default items partial, the target is the `.umb-block-grid__layout-item` cell.

After resolving, the page contains no invisible characters. `canvas-debug.js`, the spike's version of #17, outlines the targets and lists any markers that were rendered but couldn't be resolved.

## Detection matrix

✅ automatic · 🟡 partly automatic · ❌ needs opt-in, or edit in the side panel instead

| Case | | Notes |
|---|---|---|
| Textstring/Textarea rendered as text | ✅ | Verified: page title and subtitle, and block headline, text and caption |
| …inside attributes (`alt`, `title`, `meta content`, `data-*`) | ✅ | Verified: `<meta name/og/twitter>` in `<head>` |
| …rendered more than once | ✅ | Verified: `metaName` → 3 tags. Every occurrence becomes a target. |
| …inside `<head>` (`<title>`, `<meta>`) | ✅ | Found, but not visible, so these go to the "Page settings" panel (#22) |
| Rich text | ✅ | Verified: page body, and rich text inside blocks |
| Blocks rendered through partials (any view name) | ✅ | Verified: Block List, Single Block, Block Grid, and blocks nested in grid areas |
| Blocks rendered inline in a template (no partial) | 🟡 | No block marker, but the block's own properties are still marked with its key. The canvas can use the nearest common ancestor. |
| Blocks rendered via view components | 🟡 | Same as above |
| Text transformed by case changes, `Substring(0, n)`, `Split()[0]`, concatenation | ✅ | The id is a prefix, so it survives |
| `Truncate(n)` | 🟡 | Marked, but the invisible prefix (4–8 characters) counts towards `n`, so it truncates slightly early in edit mode |
| Text compared in code (`== "x"`, `switch`) | ❌ | The comparison fails in edit mode. That's why only free-text editors are marked, not dropdowns or radios. |
| Text used as a URL, CSS class or id | 🟡 | The runtime strips attributes after load, but the browser may already have used the raw value (e.g. to fetch an `href`) |
| Text read by page scripts before the runtime runs, or in `<script>`/JSON-LD | 🟡 | Those scripts see the invisible characters. The runtime then strips them from the DOM. |
| Numbers, dates, toggles, dropdowns, tags | ❌ | Not marked. Edit in the side panel (#19/#22), or use an opt-in helper |
| Media pickers (`<img src>`, `background-image`) | ❌ | URLs can't carry markers. A candidate heuristic for #19: match `src` against the media URLs of the document's picker values. |
| Content pickers and links | ❌ | Side panel |
| Output of `CachedPartialAsync` | ❌ | May serve cached output that has no markers and stale values. #15 should bypass partial caching for render sessions. |

**Opt-in fallback** (not built yet): an HTML/tag helper that wraps a region with a property marker, for sites that render values the automatic detection can't see.

```cshtml
<uve-property alias="publishDate">@Model.PublishDate.ToString("d MMM yyyy")</uve-property>
```

It emits `<!--uve:p:ID-->` comments in edit mode and nothing on the live site.

## Options considered

1. **Wrap `GetBlockListHtml`/`GetBlockGridHtml` output.** Rejected. It only brackets the whole property, not each block, and it misses sites that render blocks without the helpers.
2. **A view location expander to swap in wrapped block partials.** Rejected. It depends on view names and folders (Clean even mixes `singleBlock` and `singleblock`). Keying on the partial's *model* type works whatever the naming.
3. **Comment markers for plain text.** Rejected. Razor HTML-encodes strings, so `@Model.Title` would show the comment as visible text, and comments can't go inside attributes.
4. **A server-side post-render HTML pass that turns markers into `data-uve-*` attributes.** Rejected for now. It needs an HTML parser on every render, and text markers inside attributes, `<head>` and repeated values would still need the client-side logic. Resolving in the client keeps one implementation. We can revisit if #17 needs attributes before scripts run.
5. **Opt-in helpers only.** Rejected as the default, because it breaks the "any existing site" promise. Kept as a fallback.

## Consequences and follow-ups

- **Protocol (#12):** the canvas runtime, not `canvas-debug.js`, sends the resolved targets to the backoffice. Payload per marker: kind, owner key, `ownerIsBlock`, alias and culture, plus rects on request.
- **#15** should:
  - fold `BlockKeys` into the session;
  - turn off partial caching for render sessions;
  - ship a real canvas script in place of the debug one.
- **#17:** move `markers.ts` into the canvas runtime, and add a `MutationObserver` so markers are re-resolved after DOM patches (#18).
- **#20 (inline text):** a marker from a text node whose parent contains only that value can be edited in place. If the value was transformed (the text doesn't equal the stored value), fall back to the side panel.
- **#24:** blocks rendered without partials, using the nearest common ancestor of the block's property markers.
- **#38 (compatibility):** check the `🟡`/`❌` rows on a second site, and record the limits in the README.
- **Stega characters and layout:** zero-width characters could in theory affect line breaking before the runtime strips them. No effect seen on the Test Site.
- **Not verified in this spike:** InMemoryAuto model reloading while the model factory is decorated. The decorator delegates `IAutoPublishedModelFactory` and should be fine, but it's worth checking in #15 by changing a document type while the site is running.
