# Umbraco Visual Editor

The **Visual editor** gives Umbraco editors a way to edit content on the page itself. It adds a **Visual editor** tab to documents that shows the site's real front end, including changes that aren't saved yet. Editors can:
- edit text and rich text in place;
- select, move, add, duplicate, copy and delete blocks;
- edit everything else with Umbraco's own property editors, in a side panel beside the page.

The standard editor (the **Content** tab) is one click away, and saving and publishing work as they always do.

It reuses the CMS's property editors and reads the site's templates as they are, so it works with an existing document model without changes. It's published as the NuGet package **Arjo.VisualEditor**.

## Install

Install the package version that matches your Umbraco version's major:

| Umbraco | Arjo.VisualEditor |
|---|---|
| 18.x | 18.x |
| 17.x | 17.x |

```bash
dotnet add package Arjo.VisualEditor
```

Run the site and open a document that has a template: it gets a **Visual editor** tab next to **Content**. Nothing else is needed.

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

Aliases are case-insensitive. The site fails to start if an alias is blank or appears in both lists. The Visual tab is hidden where the editor isn't offered, and the render endpoint refuses those documents with a 403.

## Templates, helpers and limitations

The Visual editor recognises content however templates write it: models (ModelsBuilder or compiled), `Value()`, partials, block views, view components and cached partials. Some markup can't be recognised as a block on its own, such as a partial that only gets the block's element. For that there's `Html.VisualEditorBlock`:

```cshtml
@using Arjo.VisualEditor

@foreach (var block in Model.Cards)
{
    using (Html.VisualEditorBlock(block))
    {
        @await Html.PartialAsync("Card", block.Content)
    }
}
```

What works on its own, where the helper is needed, and the limitations are in [docs/compatibility.md](docs/compatibility.md). One example of a limitation: text the template changes before showing it can only be edited in the side panel.

## Security

How render sessions, the canvas frame and its messaging are protected, and the risks that remain, are in [docs/security.md](docs/security.md).

## Developing and releasing

- [docs/development.md](docs/development.md): the Test Site, the client build, tests and CI.
- [docs/releasing.md](docs/releasing.md): how a tag releases both package lines.
- [CHANGELOG.md](CHANGELOG.md): what's changed.

MIT licensed ([LICENSE](LICENSE)).
