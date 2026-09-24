# ADR 0004: Inline rich text: the backoffice's Tiptap editor, mounted on the element in the canvas

- **Status:** Accepted, implemented in #57
- **Date:** 2026-09-24
- **Issue:** #21 (spike). Prototype: `src/Arjo.VisualEditor/Client/src/spike/` (automated, runs with the client tests).

## Context

Plain text is edited in place (#20). Rich text (`Umbraco.RichText`, Tiptap in Umbraco 18) needs the same, but with:

- **The data type's configuration:** which extensions, toolbar, allowed blocks and styles are set up for this property.
- **Custom Tiptap extensions:** packages and sites register their own `tiptapExtension` / `tiptapToolbarExtension` manifests in the backoffice.
- **Blocks in the RTE**, and pickers (links, media) that open backoffice modals.
- **Style fidelity:** it should look like the page while you type.

The issue listed three options:
1. Run Tiptap inside the iframe.
2. Float the backoffice's `umb-input-tiptap` over the element.
3. Edit rich text in the side panel only.

The spike found a fourth.

## Findings

Each finding is checked by the spike tests (`spike/tiptap-in-frame.test.ts`, `spike/lit-in-frame.test.ts`), with real key presses, and against the Playground:

1. **The editor can live in the backoffice and edit an element in the frame.** The canvas is same-origin, so a Tiptap `Editor` created in the backoffice window can be mounted on an element in the iframe's document.
   - The site's CSS styles it: fonts, colours and the surrounding layout, because it *is* the page.
   - Real typing, Enter, keyboard shortcuts (Ctrl+B, Ctrl+Z) and selection work. ProseMirror takes focus and selection from `view.root`, which is the frame's document.
   - Commands run from the backoffice work, e.g. `editor.chain().toggleHeading().run()`, which is what toolbar buttons do.
2. **Tiptap can take over the site's own element.** `element: { mount: el }` makes the element itself the editor, with no wrapper, so the site's CSS selectors (`.richtext > p`, …) keep matching.
   - On the Playground, all six rich text regions (the page body and five in blocks) are the only content of their `<div class="richtext">`.
3. **Focus must go to the element directly.** Tiptap's `focus()` command runs from the backoffice window and didn't move focus into the frame. In one test run it crashed the renderer.
   - Calling `view.dom.focus()` and then setting the selection works.
4. **Backoffice Lit elements can't connect inside the frame.** Lit shares constructed stylesheets, and Chrome refuses to adopt them in another document: `NotAllowedError: Sharing constructed stylesheets in multiple documents is not allowed`. The element doesn't render at all.
   - So node views built as Lit elements, such as RTE blocks (`umb-rte-block`), can't be used as they are.
5. **The page doesn't show the stored markup.** The RTE value converter rewrites `{localLink:…}` links to URLs, resolves media, and renders RTE blocks through partial views.
   - The stored value is `{ markup, blocks }`.
   - The editor must load `markup` from the workspace, not the rendered HTML, and write `{ markup, blocks }` back, exactly as `umb-input-tiptap` does.
6. **Running Tiptap inside the iframe (option 1) would lose the backoffice's extensions.** `tiptapExtension` APIs are backoffice modules, loaded through the backoffice import map and constructed with a backoffice host (contexts, modals, localisation).
   - The canvas would need its own copy of Tiptap and would only support the extensions we bundle. Custom extensions, pickers and modals would be lost.
7. **Floating `umb-input-tiptap` over the element (option 2) can only approximate the page.** Copying computed styles doesn't bring the cascade (parents, container widths, `::before`, site fonts). It also has to follow scrolling and scaling, and its own chrome (border, toolbar) covers the page.

## Decision

**Option 4: create the editor in the backoffice, as `umb-input-tiptap` does, and mount it on the rich text's element in the canvas.**

- **Same editor as the Content tab:**
  - It uses the same data type configuration and the same `tiptapExtension` manifests (plus `Umb.Tiptap.RichTextEssentials`), instantiated with a backoffice host.
  - So custom extensions, pickers and modals behave as they do on the Content tab.
  - The loading code mirrors `UmbInputTiptapElement.#loadExtensions` / `#loadEditor`.
- **Mount target:**
  - When the rich text region is the only content of its parent element, the editor takes over that element (`element: { mount }`).
  - Otherwise it uses a wrapper element placed where the region is. Selectors that rely on direct children may then style the content slightly differently.
- **Toolbar:** `umb-tiptap-toolbar` (and the statusbar) are bound to the editor and shown **in the side panel**. They stay in the backoffice, where their Lit elements, popovers and modals work. A floating toolbar near the element can come later.
- **Value flow:**
  - Loads `markup` from the workspace value and writes `{ markup: editor.getHTML(), blocks }` back through the same path as inline text (#20, `property-values.ts`). This covers document properties and block properties.
  - Re-renders wait while editing; this protocol already exists for #20.
  - When editing ends, the canvas re-renders the stored markup through the template. That turns links back into URLs and brings back rendered blocks.
- **Starting and ending:** starting and ending follow #20: `inlineEditStart`, a go-ahead from the host, then commit on blur or Escape.
  - Rich text needs its own go-ahead message, because the host drives the editor, not the canvas.
  - Blur must ignore focus moving into the side panel toolbar.
- **Focus:** always `view.dom.focus()`, never Tiptap's `focus()` command.

### Blocks in the RTE and other Lit node views

Lit-based node views can't render in the frame (finding 4). When the editor is mounted in the canvas, the RTE block node view is replaced with a plain-DOM node view. It shows the block's **server-rendered HTML** from the canvas as an uneditable atom. Selecting it hands off to block editing (#25).

If the data type enables an extension whose node view is a Lit element that we don't replace, that property falls back to the side panel.

## Consequences

- **Style fidelity is exact**, because it's the page. The data type's RTE content stylesheets (`rte-content.css`, configured stylesheets) aren't applied. On the canvas, the site's CSS is the point.
- **The Content tab and the canvas share one editor implementation.** Behaviour, extensions and permissions don't drift.
- **Cross-window use has sharp edges.** prosemirror-view creates nodes with the global `document`; they're adopted into the frame when inserted, which works. Extensions that position UI with `window` (bubble or floating menus) position against the backoffice window. They need checking one by one, and the toolbar in the side panel avoids most of them.
- **Readonly, permissions and validation** follow the property dataset, as in #19 and #20.
- **Implemented in #57:**
  - The canvas marks the mount element and asks with `richTextEditStart`. The host (`rich-text/visual-editor-rich-text-editor.element.ts`) creates the editor on it and shows the toolbar in the side panel.
  - Tiptap's `focus` command is replaced (`rich-text/frame-focus.ts`), because toolbar buttons call `chain().focus()` after focus has left the frame.
  - Editing ends when something else is selected, when Escape is pressed, or when the side panel closes. Blur doesn't end it: toolbar popovers and modals (link and media pickers) take focus out of the frame.
  - **Not yet:** the plain-DOM node view for RTE blocks. Values containing blocks fall back to the side panel, and the block extension and block picker are left out when editing on the canvas. Extensions' own editor styles (`getStyles()`) aren't applied in the frame either.

## Options considered

| Option | Site styling | Backoffice extensions, pickers, modals | RTE blocks | Verdict |
|---|---|---|---|---|
| 1. Tiptap inside the iframe | Exact | Lost (only what we bundle) | Would need our own node view | Rejected |
| 2. Float `umb-input-tiptap` over the element | Approximate | Yes | Yes | Rejected: fidelity, positioning |
| 3. Side panel only | None (preview updates after) | Yes | Yes | Fallback |
| **4. Backoffice editor mounted in the canvas** | **Exact** | **Yes** | Plain-DOM node view needed | **Chosen** |
