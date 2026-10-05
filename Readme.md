# Umbraco Visual Editor

The **Visual editor** gives Umbraco editors a way to edit content on the page itself. It adds a **Visual editor** tab to documents that shows the site's real front end, including changes that aren't saved yet. Editors can:
- edit text and rich text in place;
- select, move, add, duplicate, copy and delete blocks;
- edit everything else with Umbraco's own property editors, in a side panel beside the page.

The standard editor (the **Content** tab) is one click away, and saving and publishing work as they always do.

It reuses the CMS's property editors and reads the site's templates as they are, so it works with an existing document model without changes. It's published as the NuGet package **Arjo.UmbracoVisualEditor**.

## Install

Install the package version that matches your Umbraco version's major:

| Umbraco | UmbracoVisualEditor |
|---|---|
| 18.x | 18.x |
| 17.x | 17.x |

```bash
dotnet add package Arjo.UmbracoVisualEditor
```

Run the site and open a document that has a template: it gets a **Visual editor** tab next to **Content**. Nothing else is needed.

Documents open on the **Content** tab, as usual. Anyone who wants them to open in the Visual editor can choose that in their profile: click your avatar, then under **Visual editor**, set **Open documents in**.

## Configuration

The editor is offered on every document type that has a template. To narrow that, add a `VisualEditor` section to `appsettings.json`. It's described in the site's `appsettings-schema.json`, so you get IntelliSense.

```json
{
  "VisualEditor": {
    "Enabled": true,
    "AllowedDocumentTypes": ["contentPage", "home"],
    "ExcludedDocumentTypes": ["errorPage"]
  }
}
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `Enabled` | `true` | Turns the Visual editor on or off everywhere. |
| `AllowedDocumentTypes` | `[]` | Document type aliases to offer it for. Empty means all of them. |
| `ExcludedDocumentTypes` | `[]` | Document type aliases never to offer it for. |
| `EnablePropertyLevelEditing` | `true` | Whether text and rich text can be edited on the page itself. When `false`, double-clicking them (or pressing Enter) opens them in the side panel instead. Blocks can still be selected, moved, added and deleted on the page. |

Aliases are case-insensitive. The site fails to start if an alias is blank or appears in both lists. The Visual tab is hidden where the editor isn't offered, and the render endpoint refuses those documents with a 403.

## Templates, helpers and limitations

The Visual editor recognises content however templates write it: models (ModelsBuilder or compiled), `Value()`, partials, block views, view components and cached partials. Blocks are recognised by the view that renders them, whether it gets the block or just its element (`block.Content`). Markup a loop writes itself, with no view per block, can't be recognised on its own. For that there's `Html.VisualEditorBlock`:

```cshtml
@using UmbracoVisualEditor

@foreach (var block in Model.Cards)
{
    var card = (Card)block.Content;
    using (Html.VisualEditorBlock(block))
    {
        <article class="card"><h3>@card.Heading</h3></article>
    }
}
```

What works on its own, where the helper is needed, and the limitations are in [docs/compatibility.md](docs/compatibility.md). One example of a limitation: text the template changes before showing it can only be edited in the side panel.

The visual editor uses DOM replacement in order to change content when you change a property in the back office, therefore any JavaScript based rendering won't work after the initial view. We inject a CSS file into the back office render so you can adjust the page view to help this, which will only show in the back office not on the front end. Add it to the site as `wwwroot/App_Plugins/ArjoVisualEditor/backoffice-render.css`: it's linked at the end of the page's `<head>`, after the template's own styles, and only if the site has it (see [docs/compatibility.md](docs/compatibility.md#styles-for-the-visual-editor-only)). Scripts can also set themselves up again after each re-render: the Visual editor fires `visual-editor:before-render` and `visual-editor:rendered` on the page's `document`, and loads the site's `wwwroot/App_Plugins/ArjoVisualEditor/backoffice-render.js` if it has one (see [docs/compatibility.md](docs/compatibility.md#scripts-for-the-visual-editor-only-and-re-render-events)).

## Security

How render sessions, the canvas frame and its messaging are protected, and the risks that remain, are in [docs/security.md](docs/security.md).

## Developing and releasing

- [docs/development.md](docs/development.md): the Test Site, the client build, tests and CI.
- [docs/releasing.md](docs/releasing.md): how a tag releases both package lines.
- [CHANGELOG.md](CHANGELOG.md): what's changed.

MIT licensed ([LICENSE](LICENSE)).
