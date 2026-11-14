# Plan: Block overlay mode ("BlockPreview")

Branch: `feature/block-preview-mode` · Status: **reviewed, decisions taken (see Decisions); awaiting the go-ahead to implement**

## Goal

An alternative way of working in the Visual editor, chosen by configuration:

- **No side panel.** The canvas (the page) takes the full width.
- Hovering still shows the outlines and labels of blocks and properties.
- **Clicking a block opens Umbraco's own block overlay** (the Block List / Grid / RTE / Single workspace modal, at the `editorSize` configured per block type), exactly as on the Content tab.
- This also works for **nested blocks**: the overlay of the block that was clicked opens straight away, not its parent's first.
- **No inline editing** (text and rich text are not editable on the page).
- **The backoffice stays as it is.** The content tree (section sidebar) stays visible, and the Visual editor shows as an ordinary workspace view, in the same area as the Content tab. Switching between Content (page properties) and the Visual editor uses the view tabs at the top right, and unsaved changes are shared because it's the same workspace (ADR 0003).
- The current setup (side panel) stays the default.

## Feasibility (research)

**Yes, it can be built**, using Umbraco's own building blocks and without copying internals.

Checked in `@umbraco-cms/backoffice` 18.2. Review agent 1 also checked 17.8.1 via the source maps: the mechanism is identical in both.

1. Every block property editor (List, Grid, RTE, Single) registers a routed modal (`UmbModalRouteRegistrationController(...).addAdditionalPath('block')`). For Grid this happens for each areas container, with the area key as a path addendum.
2. Each block is an entry element: `umb-block-list-entry`, `umb-block-grid-entry`, `umb-block-single-entry`, `umb-rte-block` or `umb-rte-block-inline`.
   - Each one has a `contentKey` property.
   - Each one provides `UMB_BLOCK_ENTRY_CONTEXT`.
3. `UMB_BLOCK_ENTRY_CONTEXT.edit()` / `.editSettings()` does a `pushState` to `{workspacePath}edit/{key}/view/content|settings`. The block workspace then sets the overlay size from the block type's `editorSize`.
   - `edit()` pushes `''` as long as `workspacePath` is still empty, so we have to wait for `workspaceEditContentPath`.
4. The overlay gets its contexts through `UmbContextProxyController` from the element that registered the route.
   - So the property editor holding the block **must stay mounted while the overlay is open**.
   - Unmounting it actively closes the modal (`hostDisconnected` → `unregisterModal`).
5. Nothing waits on visibility, so entries are also created in a `display: none` host. That includes Tiptap.

**Spike in the v17 Test Site (Home, Visual editor tab):**

- What I did: mounted a hidden `<umb-content-workspace-property alias="socialIconLinks">`, found the entry with the right `contentKey`, consumed its `UMB_BLOCK_ENTRY_CONTEXT` and called `edit()`.
- Result: **Umbraco's own "Edit Icon Link Row" overlay opened over the Visual editor.**
- Not verified in the browser yet: nested blocks, Grid areas and RTE blocks. The v17 Test Site has none of them; the v18 Test Site has Grid areas and Single.

**Nested blocks.** `arjo-visual-editor-block-editor` already renders a block's properties (including a nested Block List/Grid) with Umbraco's own editors, and writes changes back through `ArjoBlockEditController.setValue`.

- For a nested block we mount **only the property of the parent block that holds the block**, and open the nested block's overlay from there.
- The submit round trip checks out: nested manager → property context → generic dataset → `@change` → `setValue`.
- Variants are inherited from the document's dataset, the same way it works natively.

## Steps

### 1. Configuration (server)

- `VisualEditorOptions.EditorMode`: an enum, `SidePanel` (the default) or `Overlay`. Set site-wide in appsettings only.
  - XML doc: `EnablePropertyLevelEditing` is ignored in `Overlay`.
- `appsettings-schema.UmbracoVisualEditor.json`: add the enum values.
- `ConfigurationController` / `VisualEditorConfigurationResponseModel`: add `EditorMode`.
  - Regenerate the OpenAPI client (`npm run generate-client`, against one Test Site).
  - Check that `types.gen.ts` produces a string union.
- **No** manifest or middleware change. The backoffice is the only source of the mode, so the host and the canvas can't disagree (see step 2).
- Test: the default value in `VisualEditorOptionsTests`.

### 2. Protocol + canvas runtime

- New additive host message `setOpenOnClick { open: boolean }`, sent in `onConnect` like `setReadonly`.
  - An older canvas ignores unknown types (`parse` → `onInvalid`), so `PROTOCOL_VERSION` stays 1.
  - Validator plus a test in `messages.test.ts`.
- One runtime flag `openOnClick`. When it's on:
  - `editsInPlace()` returns false: no inline editing.
  - **click** on a target: `select(target)` + `openEditor`. This also applies to read-only users: Umbraco shows its overlay read-only.
  - **breadcrumb click** (selecting a parent): select + `openEditor`. Otherwise a mouse user can never reach a parent block that is entirely covered by its children.
  - **Enter**: `openEditor` straight away, skipping the "first thing inside the block" branch.
  - **double-click**: does nothing (`preventDefault`). The click already opens the overlay; dblclick would open it twice.
  - Keyboard navigation and Escape only select, as now.
- New canvas string for blank blocks in this mode (instead of `editInSidePanel`). It's an additive key: unknown keys are ignored.
- Tests in `runtime.test.ts`: click → `select` + `openEditor`; no inline edit; dblclick does nothing; breadcrumb.

### 3. New element `arjo-visual-editor-block-overlay`

Following the pattern of `arjo-visual-editor-block-picker`: it sits in the view's shadow root (so modals get their context from it) and is called imperatively.

`open(blockKey, view: 'content' | 'settings'): Promise<boolean>` takes care of all of this:

1. **Guard.**
   - Ignore it while an overlay from this element is open.
   - Ignore a request for the same key while one is pending.
   - A newer request cancels a pending one (request token), and only the newest may call `edit()`.
2. `locateBlockHolder(values, key, culture)` (existing) gives the owner (document or parent block) plus the alias.
   - If nothing is found, show the notification straight away, without polling.
   - Grid area blocks belong to the grid property itself, not to the area owner.
3. Render the hidden host from its own `@state`, separate from canvas/status/selection, and swap it synchronously before `edit()`. A host with the same holder is reused.
   - Owner is the document: `<umb-content-workspace-property alias=…>`.
   - Owner is a block: `<arjo-visual-editor-block-editor blockKey=… .culture=… onlyAlias=…>`. `onlyAlias` filters `group.aliases` and skips the tab group.
4. Find the entry element: a deep shadow-DOM search on `contentKey`.
   - One function, with the tag names in one `const` array.
   - Polls until a timeout of about 5 s.
5. Consume `UMB_BLOCK_ENTRY_CONTEXT` and **wait until `workspaceEditContentPath` (or `…Settings…`) is non-empty**.
6. **Follow Umbraco's own rules.**
   - `showContentEdit` → `edit()`.
   - Otherwise, if there are settings → `editSettings()`.
   - Otherwise do nothing, e.g. for a divider block without properties.
7. **Overlay open/closed** is followed through `UMB_MODAL_MANAGER_CONTEXT`'s stack.
   - `isOpen` is exposed for the view (undo guard).
   - On close: unmount the hidden host (no lingering observers or validators), and return focus to the canvas iframe (keyboard users).
8. Not found in time: a localised notification (`arjoVisualEditor_*` terms) with a link to the Content tab.

### 4. Wiring up the workspace view (`visual-editor-workspace-view.element.ts`, toolbar)

- Read the configuration (`loadConfiguration()`) → `_editorMode`. Render **no panel at all until it's known**, so it doesn't flash.
- `#setPanelOpen` does nothing in overlay mode, and the panel/resizer render on `!overlay && _panelOpen`.
  - That covers every call site in one place (select, insert, settings, rich text, openEditor, showError), and stops the side panel's localStorage preference being overwritten.
- **The mode when the configuration can't be loaded.** If `loadConfiguration()` resolves to `undefined` (the fetch failed, or an older response has no `editorMode`), use `SidePanel`, the documented default. Compare against a constant or enum from the generated union, never the literal string `'Overlay'`.
- **Visual mode only in `SidePanel`.** *(Superseded by 4b.3: visual mode is active in both modes, and the tree's default depends on the mode.)*
  - One idempotent helper switches it on: `#activateVisualMode()`, which calls `setActive(true)` only when `isConnected && #visualMode && mode === SidePanel`.
  - It's called from three places: the context callback, `connectedCallback` and the configuration resolving. Their order isn't fixed.
  - The helper never calls `setActive(false)`. Doing so would hide the sidebar of a second split-view pane that is active.
  - `setActive(false)` stays where it is now: unconditional, in `disconnectedCallback`.
  - In `Overlay`, visual mode stays off, so the section sidebar with the content tree stays. `active` only drives `hideSidebar`, through `Arjo.VisualEditor.Condition.VisualModeInactive`.
- Toolbar: one new property (e.g. `overlayMode`) that leaves two buttons out of the DOM (`nothing`, not hidden with CSS, so keyboard users don't tab to a useless control):
  - the panel toggle;
  - the tree toggle. The `showTree` preference of side panel mode is left untouched. *(Superseded by 4b.3: the tree toggle shows in both modes.)*
  - The "Standard editor" link stays. It's redundant with the view tabs, but harmless. *(Superseded: left out in Overlay mode, at the user's request after the third test round.)*
- **Overlay mode:**
  - `openEditor`:
    - a block, or a property in a block → `overlay.open(ownerKey, 'content')`;
    - a document property → a notification, "edit this on the Content tab", with a link to the tab holding the property (the link logic of `arjo-visual-editor-property-editor`).
  - `blockAction: 'settings'` → `overlay.open(key, 'settings')`.
  - `#onInsert` → open the overlay only after a **create**, not after paste. `insert()` reports which of the two it was.
  - `#showError`: find the target on the page through `this._targets` (not through the panel), then `setSelection` with `reveal`. An error that isn't on the page gets a notification with a link to the Content tab.
  - Undo/redo (window keydown and the canvas `history` message): ignored while `overlay.isOpen`.
- Side panel mode: functionally unchanged.

### 4b. Feedback from the first manual test round

From the comments in the manual checklist (v17, Overlay mode). Revised after review (see Review, third round).

#### 4b.1 Block actions reachable in Overlay mode

Problem: the block toolbar (move, duplicate, copy, settings, delete) only shows on a *selected* block, and in Overlay mode a click selects *and* opens the overlay. A block whose inside is a property target (Rich Text Row: the RTE fills it) only ever hovers as that property (blue), so it can't be deleted from the canvas at all.

- **A block-owned property stands for its block (Overlay mode only).**
  - One helper, `represent(target)`: for a property with `ref.ownerIsBlock`, the nearest ancestor block whose content key *or settings key* equals `ref.ownerKey`. When there's none, the property itself: for example a template that prints `block.Content.Value(...)` without a partial, which leaves no Block target.
  - It's applied in one place: inside `select()` and `hover()`. Mouse, keyboard and host-driven selections (`setSelection`, `#showError` with reveal) all go through those two.
  - `navigable()` maps every target through `represent()` and removes the duplicates, rather than filtering, so a property that stands for itself stays reachable with Tab.
  - Clicking a settings property opens its block's *content* overlay; Settings is one tab away. Before this, the host tried to open the settings key as a block and failed.
  - Page properties don't change: blue frame, and the notification on click.
- **Toolbar on hover (Overlay mode only).** A new canvas overlay option, `toolsOnHover`, set by the runtime in Overlay mode.
  - A hovered block gets its block toolbar in the *inside* position (top-right, inside the block, like `.tools.inside`). The pointer never leaves the block to reach it, so there's no gap to bridge, and it can't cover the block above it.
  - Only one toolbar at a time: on the hovered block if there is one, otherwise on the selected block.
  - Side panel mode doesn't change.
- **Tests (`runtime.test.ts`)**
  - New, in Overlay mode:
    - hovering a property inside a block hovers the block, with its toolbar;
    - a settings property maps to its block;
    - a host `setSelection` of a block-owned property selects the block;
    - Tab goes from block to block, and still reaches a property without a Block target;
    - only one toolbar shows.
  - To rewrite: the existing Overlay test that expects `caption` (a property) to be selected and opened now gets its block. The breadcrumb and Escape tests still pass, but only by coincidence; check what they assert.
  - Side panel mode: property hover, and no toolbar on hover.
- **Decision (new):** in Overlay mode the canvas works per block. Hover, click, Tab and host selections all land on the block. It goes in `docs/protocol.md` and the `runtime.ts` header (step 5).

#### 4b.2 The "+" buttons

The round "+" buttons on a block's top and bottom edge draw the text "+", which sits off-centre depending on the font. Draw it as an SVG plus, like the toolbar icons. This applies to both modes.

#### 4b.3 Tree toggle in Overlay mode

This was an optional extra before; it's now asked for. **It supersedes** "Visual mode only in `SidePanel`" (step 4) and the "except in Overlay mode" doc edits (step 5).

- The toolbar shows the tree toggle in Overlay mode too. `overlayMode` only leaves out the side panel toggle now.
- **One preference** (the existing key). When nothing is stored, its default depends on the mode: shown in Overlay mode (Decision 5), hidden in side panel mode.
  - The mode is site-wide, so one key is enough.
  - `ArjoVisualModeContext` gets the default from `loadConfiguration()` itself (cached, site-wide). The view doesn't pass the mode, so there's no ordering to get right. `active` is only set after the configuration has loaded anyway, so the tree doesn't flash.
- `#activateVisualMode()` activates in both modes. Leaving the view already sets `active` to false (`disconnectedCallback`), so the tree comes back on the Content tab without extra code.
- Comments to update:
  - the workspace view's class comment and `#activateVisualMode`;
  - the toolbar's `overlayMode` doc ("the content tree always shows");
  - the context's class comment.
- Test: the default per mode when nothing is stored; a stored choice wins.

#### 4b.4 Test content (v18 Test Site, through the backoffice so uSync writes the files)

The v17 Test Site has no uSync; its content only lives in its local database. So test content goes into the v18 Test Site's Playground, and the cases below are tested on v18 only. The Playground already has:

- Grid areas: `[BlockGrid] Playground`, the two-column block. These go through the document-level host.
- Culture variants: `/playground/` (en-US) and `/da/legeplads/` (da-DK).
- Single Block: the hero.

What's missing is a block *inside another block's property* (the nested host, `onlyAlias`) and RTE blocks. All of it is Playground-only, so Clean's own data types don't drift from Clean:

- Element type `playgroundCallout`: one `text` property (Textstring).
- Data type `[RichText] Playground`: a copy of Clean's `Richtext editor`, plus the **Block picker toolbar button** (`Umb.Tiptap.Toolbar.BlockPicker`; the Block extension alone doesn't let editors insert one), with `playgroundCallout` allowed. Playground `body` switches to it.
- Data type `[BlockList] Playground Nested`, allowing `playgroundCallout`.
- Element type `playgroundNested`, with:
  - `items` (`[BlockList] Playground Nested`): a Block List in a block;
  - `text` (`[RichText] Playground`): an RTE block in a block.
- `playgroundNested` is allowed in `[BlockGrid] Playground`. One goes in the Playground grid, in both languages, with a callout in `items` and in `text`. There's also a callout in Playground `body` (an RTE block at document level).
- Partials:
  - `blockgrid/Components/playgroundNested.cshtml`;
  - `blocklist/Components/playgroundCallout.cshtml`;
  - `richtext/Components/playgroundCallout.cshtml`.
  - They don't use the `.umb-block-list` class: the E2E tests pick the first one.
- A block with only settings (added during step 6): element type `playgroundDivider` with no properties, Clean's `Rich Text Row Settings` as its settings, allowed in `[BlockGrid] Playground` (not in Clean's `[BlockList] Main Content`, so Clean's data types stay as they are). One goes in the en-US grid. Partial: `blockgrid/Components/playgroundDivider.cshtml`.
- `docs/development.md`, the test content table: add rows for nested blocks, rich text blocks and the settings-only block.
- CI's leak check now covers RTE block partials on `/playground/`: run CI before opening the PR.
- Needs: the v18 Test Site running (https://localhost:44394), and a login.

#### 4b.5 Checklist and report

- The checklist (local, not committed):
  - reword the "+" item with concrete steps;
  - add items for the hover toolbar, settings properties and the tree toggle;
  - mark which items are v18-only (nested blocks, RTE blocks, culture variants).
- When the feature is done: the manual test report, committed, at `docs/testing/manual-checklist-report.md`.
  - In English, without local URLs or credentials.
  - Contents: the versions and the date; each item's result and notes; what was found and fixed.
  - A short version goes in the PR description.

### 4c. Block toolbars of nested blocks (Overlay mode)

From the second manual test round (v18, Overlay mode). Revised after review (see Review, fourth round).

**Problem.** A layout block (`Playground Two Column`) has its toolbar inside its top-right corner. The block in its right area has its own top-right corner in about the same place. On the way to the layout's toolbar the pointer crosses that block. The hover moves to it, and its toolbar replaces the layout's in the same spot. So the layout's actions (move, duplicate, copy, delete) can't be reached with the mouse. A layout whose areas fill it can't be hovered at all.

**Approach: a "parent block" button in the toolbar** (Overlay mode only; side panel mode doesn't change). This is how Gutenberg and Builder.io do it.

- **The button.** The hovered block's toolbar (still one at a time, inside its top-right corner) gets a first button when the block has a block ancestor.
  - Icon: a "level up" arrow (↰), so it isn't confused with Move up (↑).
  - Tooltip: "Select Playground Two Column" (the existing `selectParent` string).
  - Only on the *hovered* block's toolbar (`target === hover`, which also covers a hovered block drawn as selected), not on a selection-only toolbar. So side panel mode stays as it is.
  - It's its own button, not a `BlockTool`: `ICONS` and `onBlockTool` are for host actions (`blockAction`), and this one stays in the canvas.
- **A click on it lifts the hover to the nearest block ancestor.** The outline, label and toolbar move to the parent.
  - The parent's toolbar is drawn in its own top-right corner. That's the same corner the pointer is already in, or close to it.
  - When the parent has an ancestor of its own, its toolbar has the button too. So any depth can be reached one click at a time.
- **While lifted, the hover stays on that ancestor.**
  - Over the ancestor or anything inside it, it stays put. Over the overlay too, as already happens.
  - Over a target outside the ancestor, or outside every target (beyond the existing slop), the hover goes back to normal.
  - This is one check *at the start of* `hoverTarget()`, on the raw target, before `represent()` maps it: if it is the lifted block or inside it, return the lifted block.
  - For a parent that can't be moved (Single Block, RTE block, a block without a placement), the slop doesn't apply. Outside it, the hover lets go straight away.
- **A click while lifted opens the lifted block**, not the block under the pointer. What's outlined is what opens.
  - In `onClick`, before `select()`: when the raw target is the lifted block or inside it, use the lifted block.
  - Double-click, the breadcrumb and Enter don't change.
- **A second click doesn't hit the parent's toolbar.** After the lift, the parent's toolbar has one button fewer, so its buttons shift about 20px. The toolbar's click handler ignores `event.detail > 1`.
- **A tall parent's toolbar stays on screen.** Inside toolbars are kept in view: `top = max(4, -rect.top + 4)`. Otherwise a layout scrolled past its top gets an invisible toolbar right after the lift.
- **A parent without tools** (`blockTools()` gives none) gets a toolbar with only the button, if it has an ancestor of its own. Otherwise there's no toolbar. The toolbar is built as `[parent button?, ...tools]`, and drawn when that list isn't empty.
- **Runtime ↔ overlay.**
  - Two new overlay options: `parentBlock?: (target) => CanvasTarget | null` (the nearest block ancestor, through `index.ancestorsOf`), and `onParentBlock?: (target) => void`.
  - The runtime keeps a `lifted: CanvasTarget | null`.
  - It's tied to `hover()`: any hover of something else clears it (`if (target !== lifted) lifted = null`). That covers a pointer leave, drag start and letting go.
  - A re-render finds it again in the new index (`index.find(ref)`), so after a tool action (duplicate, settings) the lift stays.
- **No change to:** the "+" buttons, the drag handle, labels, the selection and side panel mode.
- **Tests (`runtime.test.ts`, Overlay mode)**
  - `outer` gets a placement (through `restart`, marker 2), so it has tools.
  - Hovering `inner`: its toolbar has the button; `outer` has no button of its own (no block ancestor).
  - Clicking the button: the hover goes to `outer`, with its toolbar, still one toolbar.
  - While lifted, pointerover on `caption` / `inner` keeps `outer`. Pointerover on `title` lets go and hovers the title.
  - A click on `caption` while lifted opens `outer`.
  - A render keeps the lift. A pointer leave drops it.
  - A second click (`detail: 2`) on the toolbar does nothing.
  - The button sends no `blockAction`.
  - Side panel mode: no button.
- **Comments to update:** the overlay's `toolsOnHover` doc, and the runtime header (the canvas works per block, and how to reach a parent).

**Alternatives considered**

- **Ancestors' toolbars all shown at once (Elementor style), containers above, leaves inside.** This was the first version of this step, and review rejected it:
  - a 4px gap above the block still loses the hover to the block above;
  - a container scrolled to the top falls back to inside, which is a common case;
  - toolbar widths are only known after layout;
  - labels and "+" buttons collide;
  - the selection and an ancestor can be the same block.
- **Container toolbar outside, with no ancestors.** The path to it still crosses the inner block. A layout filled by its areas can't be hovered at all.
- **A hover delay** (keep the old toolbar a moment while the pointer heads for it). It feels slow, depends on timing, and is hard to test.

### 4d. The property's name on an empty property's "Add block"

From the third manual test round. Not specific to Overlay mode: it applies to both modes. Revised after review (see Review, fifth round).

**Problem.** A page with several empty Block List / Block Grid properties shows the same "+ Add block" button in each (#97 spots). You can't tell which property each one adds to.

**Approach: the button says it, "+ Add block to Cards"** (the property's display name). Not a separate label on the box: in line mode (a hover-only 12px strip) that would be squeezed or invisible.

- **Server.**
  - `EmptyBlocksSpot` gets `Guid? ContentTypeKey`, the owner's type: `PropertyType.ContentType?.Key`, nullable like in `MarkedProperty.Register`. For a block element or a composition that's the owner's flattened type, so its `CompositionPropertyTypes` has the property.
  - One small internal helper, "property name by content type key and alias", is used by both `MarkerInjectionMiddleware.WithLabels` and `EmptyBlocksMarker`. That way there's one copy of the lookup.
  - `EmptyBlocksMarker` adds `label` to the `data-uve-empty-blocks` JSON, through `IContentTypeService` from `RequestServices`.
  - The lookup is wrapped in try/catch, like `SafeWithLabels`. The marker runs inside the template, so a failure must never break the render. When it fails (an exception, no service, no key, an unknown type or alias), there's no `label`.
- **Client.**
  - `readEmptyBlockSpots` returns `{ element, at, label? }`. The label stays out of `at`, which goes to the host unchanged in `blockInsertRequest`.
  - `refreshPlaceholders` uses a new canvas string, `addBlockTo: 'Add block to {0}'`, when there's a label, and `addBlock` otherwise.
  - The key goes in `protocol/strings.ts` only. `localization/en.ts` and the host's `CANVAS_STRING_KEYS` pick it up from there.
  - `.placeholder-add` gets `white-space: nowrap`, a `max-width` within its box, and an ellipsis, so a long name can't wrap over the page. The button's `title` has the full text.
- **No change to:**
  - empty grid *areas*, which stay "+ Add block";
  - blank blocks ("Click to edit the content");
  - the line placeholders' behaviour (only their text).
- **Tests.**
  - C#:
    - `BlockTemplateExtensionsTests`: no `label` without an `IContentTypeService` (the existing setup), and the label with a fake one (`DispatchProxy`, as the file already does for `IHtmlHelper`; no new mocking package).
    - `MarkedPropertyTests` lines 101 and 114 compare whole `EmptyBlocksSpot` records: add the key there.
  - Client:
    - `readEmptyBlockSpots` reads the label;
    - the button says "+ Add block to Cards", with the full text in its `title`;
    - without a label it says "+ Add block".
- **Docs.** `docs/compatibility.md`, in the empty Block Lists section: the button names the property. A name with a dictionary key (`#key`) shows as it is, like the other labels.

### 5. Documentation

- `Readme.md` + `README.nuget.md`:
  - the setting in the table;
  - a short description of overlay mode;
  - that `EnablePropertyLevelEditing` doesn't apply in this mode.
- `docs/compatibility.md`, limitations:
  - no inline editing, Page settings or error list;
  - document properties are edited on the Content tab;
  - server validation errors don't show in the overlay of a *nested* block;
  - custom Block Grid views without `<umb-block-grid-areas-container>` make area blocks unreachable;
  - nested blocks in *settings* and segments aren't supported;
  - a click in an empty-area box opens the parent.
- `docs/protocol.md`:
  - the `setOpenOnClick` row;
  - `openEditor`, Enter and Escape in this mode;
  - the new string key.
- `runtime.ts` header comment.
- "Visual mode hides the tree" (ADR 0003 decision 2, the workspace view's class comment, `CHANGELOG.md`, the Readme's description of Overlay mode): add that in Overlay mode the tree shows by default, and the toggle hides it (4b.3). ADR 0003's "Condition scope" stays correct.
- Overlay mode works per block: hover, click, Tab and host selections land on the block, and a hovered block shows its toolbar (4b.1). This goes in `docs/protocol.md`, the `runtime.ts` header and ADR 0005.
- `docs/adr/0005-block-overlay-mode.md`:
  - hidden native property editors plus `UMB_BLOCK_ENTRY_CONTEXT.edit()`, rather than our own modal;
  - the mode reaches the canvas as a host message, not through the manifest.
- `CHANGELOG.md`: a bullet under the existing "Added" list.

### 6. Verification

- `npm run check`, `lint`, `test`; `dotnet test`.
- Unit test for the entry search, with a fake shadow tree.
- Test content for nested blocks: added as uSync files in the v18 Test Site, which already has Grid areas and Single (see 4b.4).
- In the browser, **on both Test Sites** (17 and 18) with `EditorMode: Overlay`. Nested blocks, RTE blocks, grid areas and culture variants are on v18 only: the v17 site has no such content.
  - Block types:
    - top-level Block List;
    - Block Grid, including a block in an area;
    - a nested Block List, both invariant and culture-variant;
    - an RTE block;
    - Block Single;
    - a Block List with inline editing (`useInlineEditingAsDefault`);
    - a block without properties.
  - Actions:
    - the settings button;
    - "+" with create and with paste;
    - the breadcrumb on a parent;
    - rapid double clicks;
    - Ctrl+Z with an overlay open.
  - Close / Update behaviour:
    - Update → the canvas re-renders;
    - **Close without changes → the document isn't dirty and undo stays empty**;
    - focus is back on the page after closing.
  - Other cases:
    - a read-only user;
    - a refused save with errors;
    - reload / Back with an overlay open;
    - switching back to `SidePanel`;
    - the tree shows by default in `Overlay` and can be hidden with the toggle; it comes back after leaving the view, in both modes;
    - split view (two variants) in `Overlay`.

### 6a. Fixes from the verification (v18)

Found in the browser. On the v18 Test Site, Umbraco's routed block modal shows about 4.2 s after `edit()` navigates to its route (on the Content tab, without the package: about 2.5 s). After Update or Close, the URL leaves the route at once, but `modal.onSubmit()` only settles when the router calls `forceResolve()`, about 4.2 s later (Content tab: about 2.5 s).

Bugs:

1. The first open of a block whose holder wasn't mounted yet (e.g. Image Row and Rich Text Row in the Block List "blocks") opens on **Settings** instead of Content. The block manager adds the element type structures before they load, so `showContentEdit` is `false` until they have. `firstValue(showContentEdit, () => true)` takes that `false`.
2. Ctrl+Z while the overlay is still opening (before `isOpen`) undoes the page under it. The overlay then reloads with the reverted data.
3. A click on the page within about 4 s after Update/Close does nothing. A double click right after closing opens nothing either. **Not ours, found while verifying the fix:** Umbraco's backdrop of the closing modal covers the page until it's removed, on the Content tab as well.
4. A click on another block while the first is opening (its `edit()` already navigated) supersedes it. That leaves a modal route in the URL with no modal.

Changes, all in `visual-editor-block-overlay.element.ts` unless noted:

- **A. Content or settings.**
  - Before reading `showContentEdit`, get `UMB_BLOCK_MANAGER_CONTEXT` from the entry element, the same way as the entry context.
  - Await its public `contentTypesLoaded` (bounded, with a catch). That includes compositions.
  - Then wait until `forceHideContentEditorInOverlay` is defined, and read `showContentEdit`.
  - No protected member. On a timeout, today's behaviour applies.
- **B. One request at a time, from click to fully closed.** One `#current` (block key and phase) replaces `#request`/`#pendingKey`/`#isOpen`:
  - **Preparing** (before `edit()`): a newer request takes over, as now.
  - **Navigated** (`edit()` called, modal not shown yet): new requests are ignored. While the URL still has the route, the wait for the modal keeps going, with a large cap (30 s) instead of 5 s. If the URL leaves the route first (Escape/Back), the request is cancelled silently. Only reaching the cap is a failure, with the warning.
  - **Shown**: new requests are ignored. While the overlay closes, its backdrop still covers the page, so clicks don't get here (bug 3).
  - **Closed** (`onSubmit` settled): clear `#current`.
  - The holder isn't swapped before `onSubmit` settles. Close's revert of live edits only runs then.
  - `busy` (replaces `isOpen`) = `#current` is set. It's cleared in a `finally` on every exit. The view's undo guard (`#onHistory`) uses it, so undo/redo is ignored from the click until the overlay has fully closed.
  - `isConnected` is checked before `edit()`. A user who left the view meanwhile isn't pulled back to it.
  - The route prefix is the `path` from `workspaceEdit…Path`, up to `/view/`, compared case-insensitively. Switching Content↔Settings inside the overlay, and nested modals, only change what comes after it.
- **Docs.**
  - ADR 0005:
    - the content/settings choice waits for the block's element types;
    - one overlay at a time, from click until fully closed; undo ignored meanwhile;
    - clicks ignored while it opens; while it closes, Umbraco's backdrop covers the page;
    - consequences: Umbraco's router lag, and the internals to check on upgrades (`edit()` being a URL change).
  - `docs/protocol.md`, Overlay mode: one line saying the host may ignore `openEditor` and `history` while an overlay opens or closes.
  - `docs/compatibility.md#overlay-mode`: the delays users can see.
- **Verification** in the browser (the element has no unit tests, as it needs the Umbraco runtime):
  - Image Row and Rich Text Row open on Content the first time;
  - Ctrl+Z while opening does nothing;
  - after Update/Close, `busy` clears before Umbraco's backdrop goes, and a click then opens;
  - a click on another block while opening is ignored;
  - Escape while opening leaves no route and shows no warning;
  - a settings-only block still opens on Settings.

## Risks

- **Entry elements as a hook.** The tag names and `contentKey` are public custom elements, but not a documented API. The dependency is isolated in one function, with a fallback notification. Check it on Umbraco upgrades.
- **Hidden property editors.** A big Block Grid or an RTE (Tiptap) costs some render time when opening. Custom Block Grid views (preview packages) also run their server renders hidden.
- **Cancel after "+".** The block is inserted first and the overlay opens afterwards. Close leaves the empty block in place, unlike Umbraco's create flow. Undo removes it.
- **Live preview while editing.** The canvas only re-renders after Update, unless the data type has `useLiveEditing`.

## Decisions (2026-11-13)

1. **Name:** `VisualEditor:EditorMode` = `SidePanel` (default) | `Overlay`.
2. **Who chooses:** site-wide only, via appsettings.
3. **Document properties on the page:** a click selects the property and shows a notification, "edit this on the Content tab", with a link.
4. **Page settings and the error list** go in `Overlay` mode. Errors stay marked on the page; errors that aren't on the page get a notification.
5. **Place in the backoffice:** in `Overlay` mode the content tree stays visible, and the Visual editor is an ordinary workspace view next to Content (see step 4).
   - It is *not* a tab inside the Content view (`umb-content-workspace-view-edit`). Those tabs come from the document type's containers and have no extension point.
   - Getting in there would mean injecting into Umbraco's shadow DOM, which ADR 0003 rejected for the same reason.

## Optional extras (not in the plan)

- A "Page settings" toolbar button that opens document properties in a (routed) modal.
- A `dataPath` for the nested host, so server validation errors also show in nested overlays.
- A loading indicator (the toolbar's existing `rendering` spinner) while the hidden host mounts.
- After a refused save, automatically open the overlay of the first block with an error.
- E2E tests for overlay mode: these need a separate Compat Site run with `VisualEditor__EditorMode=Overlay`.
- ~~A tree toggle in `Overlay` mode too~~: now part of the plan (4b.3).
- An appsettings default for where documents open (Visual editor or Content), on top of the per-user profile choice (#48). This is a separate feature, so it's better as a separate PR.

## Review

**Complexity: High.** The change runs across layers: C# configuration, the API plus the generated client, the protocol, the canvas runtime (inside the page) and the backoffice host. It also leans on non-public Umbraco block internals. **Three reviewers**, working independently:

| Reviewer | Focus |
|---|---|
| 1 | Correctness against Umbraco internals (v18.2 dist + v17.8.1 source maps) |
| 2 | Architecture, maintainability and simplicity |
| 3 | Edge cases, interaction design, state and races |

### Accepted (worked into the plan)

| # | Finding | Reviewer(s) |
|---|---|---|
| 1 | `edit()` pushes `''` while `workspacePath` is still empty: wait for a non-empty `workspaceEditContentPath` | 1, 3 |
| 2 | Disconnecting the host actively closes the overlay. Needed: re-entrancy guard, request token, idempotent host, swap before `edit()` and never while a modal is open, dblclick does nothing | 1, 2, 3 |
| 3 | Two sources for the mode (cached config vs per-render manifest) can disagree, and an enum would serialise as a number in the manifest → use a host message `setOpenOnClick` and drop the manifest/middleware change | 2, 3 |
| 4 | Hidden host in a dedicated element (the `block-picker` pattern) instead of a controller plus view state; the view is already 850 lines | 2 |
| 5 | `#setPanelOpen` is also called on `select`: make it a no-op in one place; no panel until the config is known | 2, 3 |
| 6 | Pass `culture` to the nested host (otherwise culture-variant nested blocks don't work) | 1, 3 |
| 7 | `#showError` goes through the panel: resolve through `_targets` instead | 3 |
| 8 | Undo with an overlay open overwrites the edit in progress: ignore it while open | 1, 3 |
| 9 | Focus back to the canvas after closing | 3 |
| 10 | Follow `showContentEdit` / settings (blocks without properties, hide-content-editor) | 3 |
| 11 | Breadcrumb click opens the parent (otherwise unreachable with the mouse) | 3 |
| 12 | "+" opens the overlay only after create, not paste | 3 |
| 13 | New canvas string instead of `editInSidePanel`; protocol.md rows for `openEditor`/Enter/Escape | 2, 3 |
| 14 | Limitations in the docs: nested validation, custom grid views, settings-nested, segments, empty-area click | 1, 2, 3 |
| 15 | Unmount the host after closing (no lingering validators/observers); check that "Close without changes" leaves things clean | 2, 3 |
| 16 | Test on both lines, nested test content as uSync in the v18 Test Site, a unit test for the entry search | 2 |

### Rejected

| Finding | Reason |
|---|---|
| Check `propertyViewGuard` up front | The timeout fallback covers it. The extra code doesn't earn its place for an edge case. |
| A loading indicator while mounting | Nice-to-have; moved to the optional extras. |
| Double undo in split view | A bug that already exists, outside the scope of this feature. |

### Second round: keeping the tree visible in Overlay mode (Decision 5)

**Complexity: Low.** It's limited to the workspace view and the toolbar. I checked myself that `active` only drives `hideSidebar`. **One reviewer**, focused on correctness and side effects.

- **Accepted:**
  - one idempotent `#activateVisualMode()` instead of three loose `setActive` calls (a race that could leave the sidebar hidden);
  - a configuration that fails to load means `SidePanel`;
  - the toggles left out of the DOM rather than hidden with CSS;
  - docs that say "visual mode hides the tree" (class comment, ADR 0003, CHANGELOG);
  - split view in the checklist.
- **Rejected:** a default of `showTree = true` in Overlay mode as the alternative. It overwrites the user's side panel preference, and it still sets `active` while the chrome isn't hidden.
- **Decided:** the "Standard editor" link stays. It's redundant, but harmless. *(Later reversed: it's left out in Overlay mode.)*
- **Optional extra:** a tree toggle in Overlay mode (full width).

### Third round: feedback from the manual test round (4b)

**Complexity: Medium.** It touches several files: the canvas runtime and overlay, the visual mode context, the workspace view and toolbar, plus test content in the v18 Test Site. There's no data model, security or API change. **Two reviewers**, working independently:

| Reviewer | Focus |
|---|---|
| 1 | Correctness: the canvas runtime and overlay, context/mode, edge cases |
| 2 | Architecture, UX, simplicity and scope; test content and CI |

**Accepted:**

| # | Finding | Reviewer |
|---|---|---|
| 1 | Settings properties carry the settings key as `ownerKey`: map on content key *or* settings key | 1 |
| 2 | Filtering `navigable()` makes properties without a Block target unreachable: map and dedupe instead | 1 |
| 3 | Host-driven selections (`setSelection`, `#showError`) bypassed the mapping: apply it inside `select()`/`hover()` | 1 |
| 4 | A hover toolbar above the block covers the block above, and a bridge strip intercepts its clicks: put the hover toolbar inside the block, with no strip | 1, 2 |
| 5 | Two toolbars at once: only one, hover first | 1 |
| 6 | The existing Overlay test (expects `caption` selected) changes; check the breadcrumb and Escape tests | 1 |
| 7 | The plan and docs contradicted 4b.3: marked as superseded, and step 5 reworded | 1, 2 |
| 8 | Per-mode keys were more than asked: one key, with a default per mode, read by the context from the cached configuration | 1, 2 |
| 9 | The Playground has no block inside a block's property (the nested host): add `playgroundNested` with a Block List and an RTE | 2 |
| 10 | Clean's shared RTE would drift from Clean, and it lacks the Block picker button: use a Playground-only RTE data type with the button | 2 |
| 11 | Record "per block" as a decision, in protocol.md and the runtime header | 2 |
| 12 | Reword the "+" checklist item, and mark which cases are v18-only in step 6 | 2 |
| 13 | The "first view" appsetting is a new feature: an optional extra (separate PR) | 2 |

**Rejected:**

| Finding | Reason |
|---|---|
| A settings property should open the overlay on its Settings tab | The overlay has a Settings tab one click away. Telling the host which tab to open needs a protocol change, which the case doesn't earn. |
| Don't commit the manual test report (it doesn't fit upstream) | You asked for it to be committed. The concerns (Dutch notes, local URLs) are handled by writing it in English without local details. Its location is left open. |

### Left open

- A `dataPath` for nested validation stays an optional extra unless you'd like it in the baseline.
### Decided (third round)

- No appsettings default for where documents open: the per-user profile choice (#48) is enough.
- Test content goes on the v18 Playground (4b.4). Those cases are tested on v18 only.
- The manual test report goes to `docs/testing/manual-checklist-report.md` (4b.5).

### Fourth round: toolbars of nested blocks (4c)

Complexity **Medium**: overlay and runtime, with UI behaviour and tests. Two reviewers on the first version, each with a different focus, and one more review on the revised version because the approach changed.

**First version** (show the ancestors' toolbars too: containers above, leaves inside).

- **Correctness and edge cases:**
  - the 4px gap above a container loses the hover;
  - with no room above, the container falls back to inside, which is common;
  - toolbar widths are only known after layout;
  - the selection and an ancestor can be the same block;
  - collisions with the "+" and the labels.
- **UX and design:** the same objections, and a recommended alternative: a "parent block" button in the toolbar (Gutenberg, Builder.io). It solves the bug at any depth with far fewer moving parts.

Accepted: switched to the parent button. The first version is under Alternatives considered.

**Revised version** (correctness of the lift). Accepted, and worked into 4c:

1. The lift check goes at the start of `hoverTarget()`, on the raw target (otherwise `represent()` hovers the child).
2. `lifted` is tied to `hover()`, rather than listing every place that clears it.
3. A re-render finds the lifted block again, so a tool action doesn't drop the lift.
4. A second click (`detail > 1`) is ignored, so it doesn't hit the parent's shifted buttons.
5. Inside toolbars stay in view on a tall block scrolled past its top.
6. The button only goes on the hovered block's toolbar.
7. The button isn't a `BlockTool`, and the toolbar is drawn for the parent button alone too.
8. A click while lifted opens the lifted block (in `onClick`).
9. Plus the extra tests.

Rejected: "the button *selects* the parent, without a lift". When the overlay closes, the selection stays, and the child blocks never get their own toolbar.

Changed after the verification (2026-11-14): the button now lifts **and** selects the parent. Found manually: after a child's overlay closes, the child stays selected; lifting only the hover then left two blocks looking active (the child's selected box and the parent's hover box). With the lift kept, children still get their own toolbar on hover, so the objection above doesn't apply. It selects without opening (like Escape); the breadcrumb selects and opens. One reviewer (correctness): the host echo, re-render and Escape paths don't conflict; the tests that read the hover box, `Readme.md` and the code comments needed updating. Decided with Arjan: it always selects the parent, also when another block was selected.

### Fifth round: the property's name on "Add block" (4d)

Complexity **Medium**: server (marker JSON, a shared lookup) and client (marker reading, string, CSS), with tests on both sides. Two reviewers, each with a different focus: correctness of the data flow, and design/UX/maintainability.

Accepted, and worked into 4d:

1. A try/catch around the lookup. The marker runs inside the template, so a failure must never break the render (both reviewers).
2. `ContentTypeKey` is nullable (`PropertyType.ContentType` can be null).
3. One shared helper for "property name by type key and alias", instead of a second copy of `WithLabels`'s lookup (both reviewers).
4. A long name doesn't wrap: `nowrap`, a `max-width` and an ellipsis on the button, with the full text in its `title` (both reviewers).
5. The label stays out of `at`, so `blockInsertRequest` doesn't change.
6. `MarkedPropertyTests` compare whole `EmptyBlocksSpot` records: update them.
7. Test with a `DispatchProxy` fake of `IContentTypeService`, with no new mocking package.
8. Dropped from the plan:
   - the `localization/en.ts` edit, because it spreads `DEFAULT_CANVAS_STRINGS`;
   - the `docs/protocol.md` edit, because it has no list of string keys.
9. Docs: a name with a dictionary key shows raw, the same as the existing labels.

Left as optional suggestions (not in the baseline):

- The area's name on an empty grid area's button too. It's client-only, but areas sit side by side in one block and are easy to tell apart.
- The block's type name for an empty property inside a block, e.g. "Items · Card". Without it, repeated blocks of one type still show the same text.
- Resolving dictionary keys (`#key`) in names. That applies to every label, so it's a separate issue.

Performance (one `IContentTypeService.Get` per spot, served from Umbraco's cache) is fine for a few spots per page. No extra cache.

### Sixth round: fixes from the verification (6a)

Complexity **Medium**: one element plus the view's undo guard, but its concurrency logic runs against Umbraco's router timing. Two reviewers, each with a different focus: correctness and concurrency, and design, simplicity and upgrade risk.

Accepted, and worked into 6a:

1. Fix A first waited for the protected `_contentStructureHasProperties` to be defined. That doesn't fix the bug: the structures start empty, so it goes `undefined → false → true` (both reviewers, checked in the sources). It now uses the public `UMB_BLOCK_MANAGER_CONTEXT.contentTypesLoaded`, compositions included.
2. The 5 s wait after `edit()` was shorter than Umbraco's measured 4.2 s. With "can't be superseded" it would recreate bug 4 (both reviewers). The wait now keeps going while the URL has the route (cap 30 s). If the URL leaves the route first, the request is cancelled silently.
3. One `#current` plus one `#next` slot, with explicit phases, instead of separate flags. `busy` is cleared in a `finally` (both reviewers).
4. The "closing" test only runs once the overlay shows. Before `edit()` the route isn't in the URL yet either.
5. The route prefix comes from Umbraco's own `path` up to `/view/`, compared case-insensitively, not a hand-written `/block/edit/<key>` (both reviewers). Umbraco itself uses `location.href.includes(...)` when it closes a routed modal.
6. A queued request is dropped (silently) when the element was disconnected or the block is gone. `isConnected` is checked before `edit()`.
7. The holder isn't swapped before `onSubmit` settles: Close's revert of live edits runs at `forceResolve`.
8. `await updateComplete` between clearing the holder and opening the queued request.
9. Docs: ADR 0005, one line in `docs/protocol.md`, the delays in `docs/compatibility.md`.

Rejected:

- Waiting for `inlineEditingMode` too. The block manager's `contentTypesLoaded` and the block type cover it; Grid doesn't use it, and the List manager sets it before its entries render.
- "On a real failure, navigate off the route." It adds a URL change of our own for a case that only happens after 30 s. The warning says where the block can still be edited.

Left as optional suggestions (not in the baseline):

- A busy cursor or the toolbar spinner while an overlay opens. For 2.5–4 s nothing visible happens after a click, on the Content tab as well.
- Queueing Ctrl+Z while busy instead of ignoring it (it's ignored for about 4 s after Update/Close).
- A safety net that clears `busy` when the modal leaves the modal manager's list, in case `onSubmit` never settles (the same risk as today's `isOpen`).
- Finding out why the router lag is about 1.7 s longer in the Visual editor than on the Content tab.

Changed during implementation: **B3 (queueing a click while the overlay closes) was dropped.** Measured: Umbraco's `DIALOG` backdrop stays over the page until after `onSubmit` settles, so a click on the page never reaches the canvas while `busy` is true after Update/Close. Bug 3 was that backdrop (the same on the Content tab), not the package. Items 3 (the `#next` slot), 6 (the queued-request checks) and 8 (`await updateComplete`) went with it. The `isConnected` check before `edit()` stays.

Verified on v18 after 6a:
- Image Row and Rich Text Row open on Content.
- Ctrl+Z while an overlay opens, and right after Update, does nothing.
- A click on another block while one opens is ignored, and the first one opens.
- `busy` clears before Umbraco's backdrop goes.
- A block with only settings (Playground Divider, in the grid and earlier in a Block List): "+" opens it on Settings, and so does a click on it afterwards.
- `npm run generate-client` against v18: `editorMode` / `VisualEditorMode` in the generated types (the base URL kept at `localhost:44394`). `check`, `lint`, `test` (322) and `dotnet test` (92, built for 17) pass.

Left open: **browser Back within a fraction of a second of the click** (before the overlay shows) leaves the overlay's route in the URL. The overlay shows briefly and closes, because its holder was cleared. There's no warning, and the next click works. Umbraco's history handling plays a part (the URL stayed on a modal route after `history.back()`). This is not a regression: before 6a, the same case waited 5 s and showed a warning.
