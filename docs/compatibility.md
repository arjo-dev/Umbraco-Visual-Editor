# Compatibility

The Visual editor reuses a site's own templates, so it has to find, in whatever HTML they write, which bits are which property or block. This page says what it copes with on its own, what needs a helper, and what it can't do. It was checked in #38 against two sites:

- **The Test Site** runs the Clean starter kit, with in-memory ModelsBuilder (InMemoryAuto) and uSync content.
- **The Compat Site** (`Umbraco Visual Editor.Compat Site`) is plain Umbraco, with compiled models written by hand (ModelsBuilder mode `Nothing`). Its templates use other conventions: hand-rolled block loops, a view component, `CachedPartialAsync` and output caching. Its content is created in code on first boot.

Both are covered by the end-to-end tests in CI (`tests/e2e`: `npm test` and `npm run test:compat`). The Compat Site is also run on Umbraco 17 (see below).

## Umbraco versions

The Visual editor supports **Umbraco 18** (the default) and **Umbraco 17**.

A build is for one major version: the two aren't binary compatible where the package touches them. To build for 17, set the Umbraco version for MSBuild:

```bash
dotnet build src/UmbracoVisualEditor -p:UmbracoVersion=17.0.0
```

An `UmbracoVersion` environment variable does the same. `Directory.Packages.props` uses it for every Umbraco package, and a `17.x` version defines `UMBRACO_17`.

The differences are small:
- **Published content wrappers.** Umbraco 17's `PublishedContentWrapped` and `PublishedElementWrapped` take an `IPublishedValueFallback` in their constructors (see `UmbracoCompatibility.cs`).
- **Block elements.** Their `Properties` and `GetProperty` aren't virtual on 17, so the marking wrapper for block elements implements `IPublishedElement` again rather than overriding them.
- **The OpenAPI document.** It's only used to generate the backoffice client during development, and is registered on 18 only. Umbraco 17 documents its APIs with Swashbuckle. The API itself works the same on both.

The backoffice extension is one build for both: it's built against 18's backoffice and runs in 17's.

**What's checked on 17:** CI's `Umbraco 17` job builds the package and runs the .NET tests against Umbraco 17. It then runs the Compat Site end to end on Umbraco 17. That covers marking, editing text and rich text in place, moving and adding blocks, undo and redo, and output caching. The Test Site is 18-only (its Clean and uSync versions are), so the rest of its flows are only checked on 18.

## How the editor finds things

In the Visual editor, and only there, the page is rendered with markers (ADR 0002):

- **Text values** carry invisible characters. However a template writes the value (a ModelsBuilder property, `Value<T>()`, a partial, a view component, a layout), the marker goes with it.
- **Rich text** is wrapped in HTML comments around the value.
- **Blocks** are wrapped in HTML comments by the view that renders them. This happens automatically when the view's model is the block (`BlockListItem`, `BlockGridItem`, a single block: anything that's an `IBlockReference`), whatever the view is called or wherever it lives.

## What works on its own

| Convention | Works | Checked on |
|---|---|---|
| ModelsBuilder InMemoryAuto | Yes | Test Site |
| Compiled models (SourceCodeManual/Auto, or written by hand) | Yes | Compat Site |
| No models (`Model.Value<T>("alias")`) | Yes. The marker is in the value, not the model. | Compat Site (its models use `Value<T>`) |
| Umbraco's default block partials (`GetBlockListHtmlAsync`, `GetBlockGridHtmlAsync`, `GetBlockHtmlAsync`) | Yes | Test Site |
| Hand-rolled block loops whose partial gets the block | Yes | Compat Site |
| View components | Yes | Compat Site |
| `Html.CachedPartialAsync` | Yes. In the Visual editor it always renders fresh, with markers, and never fills the cache, so visitors never get marked or unsaved output. | Compat Site; the Test Site in CI, with `Hosting:Debug=false` |
| ASP.NET output caching | Yes. The package keeps render sessions out of it, whatever the site's policies (see below). | Compat Site |
| Another model factory (a community ModelsBuilder, say) | Yes. The package wraps whichever `IPublishedModelFactory` the site ends up with. | Test Site (InMemoryAuto), Compat Site (the default factory) |

## Opt-in helpers

### `Html.VisualEditorBlock`

A block the page can't tell is a block needs marking by hand. That's markup written inline in a loop, or a partial that only gets the block's element:

```cshtml
@using UmbracoVisualEditor

@foreach (var block in Model.Cards)
{
    using (Html.VisualEditorBlock(block))
    {
        @await Html.PartialAsync("Card", block.Content)
    }
}
```

It takes the block (`IBlockReference`) or its element (`IPublishedElement`). Outside the Visual editor it writes nothing.

Without it, the block's text can still be edited in place (its values are marked), but the block itself can't be selected, moved, duplicated or deleted on the page, and has no "+" buttons. It's still in the side panel under Page settings.

## Limitations

- **Text the template changes can't be edited in place.** Text is only editable in place when the page shows it exactly as it's stored. Truncated, reformatted or combined text can still be selected, and edited in the side panel.
- **Values used only in attributes or CSS can't be selected on the page.** Examples are a background image in a `style`, a URL, or a `data-*` attribute read by a script. They're listed under **Page settings** in the side panel. The Test Site's hero image is one.
- **Content from other pages isn't editable here.** For example, a footer that renders the home page's properties. It's edited on its own page.
- **Scripts that build markup after the page loads** (a carousel, a code highlighter) aren't run again when an edit is patched into the page (#18). What they add may be missing until the page is reloaded.
- **Output caching and publishing.** Render sessions are never output-cached, but the site's own pages are, as the site configures them. After publishing from the Visual editor, visitors see the change once the cached page expires or is evicted, exactly as when publishing from the Content tab.
- **Strict Content Security Policies** need to allow the canvas script (see [security.md](security.md)).

## Output caching and render sessions

ASP.NET output caching doesn't honour `Cache-Control: no-store`. On a site that output-caches every page, render sessions used to be cached by their URL. They were then served again without the viewer check (#34), to anyone with the URL, for as long as they stayed cached.

The package now adds an output-cache policy that turns caching off for `/__visual-editor/render/` (`RenderSessionOutputCachePolicy`). It's added after the site's own base policies. It stops both lookups and storage, so an endpoint's own policy can't switch it back on. The Compat Site checks this in CI: a render session requested without the viewer cookie is refused, not served from the cache.

## The Compat Site

To run it:

```bash
dotnet user-secrets set "Umbraco:CMS:Unattended:UnattendedUserPassword" "<a password>" --project "Umbraco Visual Editor.Compat Site"
dotnet run --project "Umbraco Visual Editor.Compat Site"
```

It installs itself and creates its page, at https://localhost:44420. For the end-to-end tests, `npm run test:compat` in `tests/e2e` starts a throwaway copy of it instead (`npm run site:compat` keeps one running).
