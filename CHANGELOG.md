# Changelog

This lists the changes to UmbracoVisualEditor. There are two package lines, released together from the same code: **18.x** for Umbraco 18 and **17.x** for Umbraco 17. A release tagged `vY.Z` publishes `18.Y.Z` and `17.Y.Z` (see [docs/releasing.md](docs/releasing.md)).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

The first release.

### Added

- **The Visual editor:** a tab on documents with a template, showing the page as your site renders it, with changes that aren't saved yet. Umbraco's own header, culture switcher and Save / Save and publish stay as they are. While it's open, the content tree is hidden to give the page room. There's a toggle to show it again.
- **Live preview:** the page is rendered again, and patched in without reloading, as values change. Scroll position and focus are kept.
- **Editing in place:**
  - Textstring and Textarea text can be edited in place on the page.
  - Rich text is edited in place with the backoffice's own editor, whose toolbar sits above the text.
- **Side panel:** the selected property or block is edited with Umbraco's property editors, beside the page. Properties that aren't on the page are under **Page settings**.
- **Blocks (Block List, Block Grid and Single Block):**
  - select a block, and edit its content and settings;
  - drag to reorder, or move with Alt+Up/Down;
  - Block Grid areas, column spans (resize) and nesting;
  - add blocks with "+" and the block catalogue;
  - duplicate, copy (to Umbraco's clipboard), paste and delete blocks.
- **Culture and segment variants.**
- **Validation messages** on the page and in the side panel.
- **Permissions:** read-only mode for users who can't change a document, and for locked documents or ones in the recycle bin.
- **Undo and redo** within a Visual editor session (Ctrl+Z / Ctrl+Shift+Z).
- **Open documents in the Visual editor:** a setting in each user's profile (it's a choice, not remembered from the tabs they use). Links to a tab still open that tab.
- **Preview sizes:** desktop, tablet and mobile, each with a choice of sizes.
- **Keyboard navigation** on the page (Tab, the arrow keys, Enter and Escape), screen reader announcements, and backoffice localisation (English).
- **Configuration:** a `VisualEditor` appsettings section (`Enabled`, `AllowedDocumentTypes`, `ExcludedDocumentTypes`), validated at startup and included in the appsettings JSON schema.
- **Blocks are recognised by their views**, whether a view gets the block or just its content element. **`Html.VisualEditorBlock`** marks markup a loop writes itself.
- **Support for Umbraco 17 and 18.**

### Security

Render sessions are only rendered for the backoffice user who created them. They're never cached (including by output caching) or indexed. Rendering never saves, publishes or creates media. See [docs/security.md](docs/security.md).
