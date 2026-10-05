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
    "ExcludedDocumentTypes": ["errorPage"],
    "EnablePropertyLevelEditing": true
  }
}
```

`EnablePropertyLevelEditing: false` turns off editing text and rich text on the page itself: they open in the side panel instead. This feature can sometimes go a little odd on setups - please raise an issue if you have trouble with this feature.

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

## Render CSS and JS injection

Because of the way we load the content into the viewer there can be issues displaying the content after change; for example if you have an animate on scroll effect in place. We inject a single CSS and JS file into the rendered view (back office only) so you can write your own corrections/workarounds for this.  
  
If the file doesn't exist, then it just won't get loaded in. The CSS lives at `/wwwroot/App_Plugins/ArjoVisualEditor/backoffice-render.css` and the JS lives at `/wwwroot/App_Plugins/ArjoVisualEditor/backoffice-render.js`.  
  
As well as just loading in these scripts we also fire events on the `document` when a render occurs.  
  
`visual-editor:before-render` happens just before we render the new content.  
`visual-editor:rendered` happens just after.  
