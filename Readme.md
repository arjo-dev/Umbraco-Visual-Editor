# Umbraco Visual Editor

This project creates a new interface to the Umbraco editor to give the editor a new experience to edit content. It draws in the front end of the website and adds a drag and drop style editing experience; giving full visual fidelity of how the output content will appear. There is a toggle in the page editor to switch it on and will allow the user to switch back to "normal" umbraco editing. It won't display the content tree or any other area of the system; it's sole focus is a nicer editing experience for content.

It reuses the property editors from the CMS for complex types so it can be applied to any existing document model setup.
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

## Security

How render sessions, the canvas frame and its messaging are protected, and the risks that remain, are in [docs/security.md](docs/security.md).

## Compatibility

Which template conventions the Visual editor copes with on its own, the `Html.VisualEditorBlock` helper for the ones it can't, and its limitations are in [docs/compatibility.md](docs/compatibility.md).
