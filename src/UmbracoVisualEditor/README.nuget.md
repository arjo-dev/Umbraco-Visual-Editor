# Umbraco Visual Editor

The **Visual editor** lets editors change Umbraco content on the page itself. It adds a **Visual editor** tab to documents that shows your real front end, including changes that aren't saved yet. Editors can:

- edit text and rich text in place on the page;
- select, move, add, duplicate, copy and delete blocks (Block List and Block Grid);
- edit anything else with Umbraco's own property editors, in a side panel beside the page.

Saving and publishing work as they do in the Content tab. Nothing about your document types or templates has to change.

## Which version

Install the package version that matches your Umbraco version's major:

| Umbraco | UmbracoVisualEditor |
|---|---|
| 18.x | 18.x |
| 17.x | 17.x |

## Install

```bash
dotnet add package Arjo.UmbracoVisualEditor
```

Run the site and open a document that has a template: it gets a **Visual editor** tab next to **Content**.

## Configure (optional)

By default the Visual editor is offered for every document type with a template. To limit it, add a `VisualEditor` section to `appsettings.json`:

```json
{
  "VisualEditor": {
    "Enabled": true,
    "AllowedDocumentTypes": ["contentPage", "home"],
    "ExcludedDocumentTypes": ["errorPage"]
  }
}
```

## Templates

The Visual editor reads your templates as they are: models, partials, view components, block views and cached partials. Blocks are recognised by the view that renders them, whether it gets the block or its element. For markup a loop writes itself, with no view per block, there's a helper:

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

Outside the Visual editor, the helper writes nothing.
