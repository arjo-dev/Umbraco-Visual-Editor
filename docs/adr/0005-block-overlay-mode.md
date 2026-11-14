# ADR 0005: Overlay mode opens Umbraco's own block overlay, through a hidden property editor

- **Status:** Accepted
- **Date:** 2026-11-13
- **Plan:** `VisualEditor:EditorMode` = `SidePanel` (the default) | `Overlay`

## Context

Some editors want the page at full width with no side panel, and blocks edited the way they are on the Content tab: a click opens the block's overlay, at the size its block type sets. That has to work for nested blocks too (a block inside another block's property, a block in a Block Grid area, a block in rich text), and open the clicked block's overlay straight away, not its parent's first.

Umbraco's block overlay isn't a modal anyone can open with a block key. Each block property editor (Block List, Block Grid, Single Block, Rich Text) registers a routed modal for its own blocks. Each block is an entry element (`umb-block-list-entry`, `umb-block-grid-entry`, `umb-block-single-entry`, `umb-rte-block`, `umb-rte-block-inline`) with a `contentKey`, and it provides `UMB_BLOCK_ENTRY_CONTEXT`. That context's `edit()` / `editSettings()` navigates to the modal's route. The overlay gets its contexts from the element that registered the route, so the property editor must stay mounted while the overlay is open.

## Decision

1. **Mount the property editor that holds the block, hidden, and call the entry's own `edit()`** (`arjo-visual-editor-block-overlay`).
   - The holder is found in the workspace's values (`locateBlockHolder`). It's the document, through `<umb-content-workspace-property>`, or the parent block, through `arjo-visual-editor-block-editor` with only that property.
   - The entry is found by a deep shadow-DOM search on `contentKey`, in one function with the entry tag names in one list.
   - It waits until the entry's `workspaceEditContentPath` (or the settings path) is set, because `edit()` goes nowhere before that.
   - Umbraco's own rules decide what opens: content when the block has content to edit, otherwise settings, otherwise nothing (a divider, say). The choice waits for the block manager's `contentTypesLoaded`, because `showContentEdit` is `false` until the block's element types have loaded.
   - The hidden editor stays mounted until the overlay has fully closed, then goes, so nothing lingers. Close's revert of live edits only runs at that point.
   - **One overlay at a time, from the click until it has fully closed.**
     - Before `edit()`, a newer click takes over.
     - From `edit()` until the overlay shows, clicks are ignored. The page is still clickable then, and taking over would leave a route without an overlay.
     - While the overlay is closing, Umbraco's backdrop still covers the page.
     - Undo and redo are ignored for the whole time, because the overlay holds its own copy of the block.
2. **The mode reaches the canvas as a host message, `setOpenOnClick`, not through the page's manifest.** The backoffice reads the setting from the configuration endpoint and is the only source of it, so the host and the canvas can't disagree. Older canvases drop the message as an unknown type, so the protocol version stays 1.
3. **The canvas works per block in this mode.** A property inside a block stands for that block: hover, click, Tab and the host's selections land on it, and a hovered block shows its toolbar inside its corner. A nested block's toolbar has a "parent block" button that moves the hover to the block around it and selects it (without opening it), so a parent covered by its children can still be moved or deleted, and a child selected earlier doesn't stay active next to it.
4. **The backoffice stays as it is.** The content tree shows by default (see ADR 0003), and the Visual editor is an ordinary workspace view next to Content. The document's own properties are edited on the Content tab.

## Options considered

| Option | Verdict |
|---|---|
| **Hidden property editor + the entry's `edit()`** | **Chosen.** Umbraco's own overlay, size, validation and submit path, with no copied internals. |
| Our own modal with the block's properties (`arjo-visual-editor-block-editor` in a dialog) | Rejected: it would differ from the Content tab (size, tabs, settings, validation), and would have to be kept in step with Umbraco's. |
| Open the routed modal by URL | Rejected: the route only exists while its property editor is mounted, and its contexts come from that element. |
| The mode in the page's manifest (server-side) | Rejected: two sources for one setting. The canvas only needs it once the host has connected. |

## Consequences

- **Entry elements are a hook.** Their tag names and `contentKey` are public custom elements, but not a documented API. The dependency is kept in one function, and a block that can't be found gives a notification with a link to the Content tab. Check it on Umbraco upgrades.
- **Opening costs a render.** A big Block Grid or a rich text editor is rendered hidden before its overlay opens.
- **Umbraco's router is slow to show and remove a routed modal.** On a local site, the overlay shows a few seconds after `edit()` changes the URL (about 2.5 s on the Content tab, more in the Visual editor). It's removed about as long after Update or Close changes it back. The waits allow for that (30 s for the overlay to show).
- **The URL is the signal for "cancelled while opening".** If the overlay's route leaves the URL before the overlay shows (Escape, Back), the wait stops without a warning. The route prefix comes from the entry's own `workspaceEdit…Path`, and it's checked the way Umbraco checks it (`location.href` includes it). Check `edit()` on Umbraco upgrades.
- **Server validation errors don't reach a nested block's overlay.** The nested host has no data path for them. They're still marked on the page.
- **A block just added keeps its place when its overlay is closed.** It's added first and opened afterwards, unlike Umbraco's create flow. Undo removes it.
- The limitations editors see are listed in [compatibility.md](../compatibility.md#overlay-mode).

## Verification

- [x] Client tests: the entry search with a fake shadow tree, the canvas's per-block behaviour, the parent block button, and the `setOpenOnClick` message.
- [x] Manually, on Umbraco 18: top-level Block List and Block Grid blocks, nested blocks, the hover toolbar and the parent block button, and the tree toggle.
- [ ] Manually, on Umbraco 17 and 18: the full checklist, including Grid area blocks, Single Block, settings and the Danish variant (see `docs/testing/manual-checklist-report.md` once written).
