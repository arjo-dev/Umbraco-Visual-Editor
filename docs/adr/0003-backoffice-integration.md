# ADR 0003: The visual editor is a document workspace view, and it hides the section sidebar while showing

- **Status:** Accepted
- **Date:** 2026-09-23
- **Issue:** #11 (spike). Used by #13 (toggle), #14 (layout) and #16 (canvas host).

## Context

Editors switch a document into a visual mode and back. The README says visual mode shows only the page, with no content tree or other areas. It must reuse the document's existing workspace, so that:

- unsaved changes survive switching in either direction;
- Save / Save & Publish / Preview keep working unchanged;
- culture variants and split view behave as they do today.

## Decision

1. **The visual editor is a `workspaceView` on `Umb.Workspace.Document`**: a "Visual editor" tab between Content and Info (weight 150; Content is 200, Info 100), at route `…/view/visual-editor`. Documents still open on Content.
   - Workspace views are rendered by Umbraco inside the document workspace, and inside the variant pane when there's a split view. So the view consumes the **same** `UMB_DOCUMENT_WORKSPACE_CONTEXT`, and the **same** per-variant `UMB_PROPERTY_DATASET_CONTEXT`, as the Content tab. Nothing is copied, so nothing can get out of sync.
   - The workspace header (name, variant selector, tabs) and footer (Save, Save & Publish, Preview, actions) stay, and they're Umbraco's own.
   - **Switching back** means clicking another tab. The route is deep-linkable, and browser Back works.
2. **Visual mode hides the section sidebar.** A global context, `ArjoVisualModeContext` (`active: boolean`), is set by the view while it's connected and cleared when it disconnects. That covers switching tab, switching document, and leaving the section.
   - The entrypoint appends a condition, `Arjo.VisualEditor.Condition.VisualModeInactive`, to **every** `sectionSidebarApp`, including ones registered later. It uses the public `umbExtensionsRegistry.appendCondition` API.
   - `umb-section-default` only renders the sidebar when at least one sidebar app is permitted, so the tree, and everything else in the sidebar, disappears and the workspace takes the full width.
   - The condition starts out permitted, so the sidebar doesn't flicker away while the context resolves.
3. **The toggle itself is #13.** The tab is the minimal toggle. #13 can add a more prominent control, such as a workspace action or a header button, that just navigates to the view's route. It can also remember each user's last choice.

## Options considered

| Option | Shares workspace and datasets | Hides tree | Verdict |
|---|---|---|---|
| **Workspace view + sidebar condition** | ✅ Same instances, by construction | ✅ Supported API (`appendCondition`) | **Chosen** |
| Workspace action that "swaps the main view" | ✅ | ✅ (same mechanism) | There's no API to swap a workspace's main content, so in practice this *is* the workspace view with a button that navigates to it. Folded into #13. |
| `UMB_WORKSPACE_MODAL` / a routed modal | ❌ Opens a **new** workspace instance with its own context, so edits in visual mode wouldn't be in the Content tab | ✅ (overlay) | Rejected: breaks "switching back loses nothing" |
| Custom full-screen modal, passing the workspace context by reference | ⚠️ The modal renders at the app root, outside the workspace, so datasets, validation and property contexts would all have to be re-provided by hand | ✅ | Rejected: brittle, and it re-implements what the workspace already provides |
| Hide the tree with CSS or DOM manipulation | ✅ | ⚠️ Shadow DOM means reaching into Umbraco internals | Rejected: breaks on upgrades |

## Consequences

- **Top bar stays:** the backoffice top bar (sections, search, user) stays visible. Hiding it would need unsupported DOM work; revisit if the product wants a truly chromeless mode (#14).
- **Space inside the workspace:** the workspace header and footer take vertical space. The canvas host (#16) should fill the rest (`height: 100%`, no padding), and the layout (#14) can decide which workspace chrome to keep.
- **Condition scope:** the condition applies to sidebar apps in *all* sections, but it only bites while `active` is true, and that's only true while the Visual editor view is showing.
- **Other packages' sidebar apps** (for example uSync's) are hidden too. That's intended ("no other areas").
- **Split view:** each variant pane renders its own workspace views. See *Verification* for how the Visual editor behaves there.

## Verification

- [x] Builds, lints and type-checks against `@umbraco-cms/backoffice` 18.2.
- [x] Visual editor tab: the sidebar hides on entry and returns on leaving. Checked manually in the backoffice.
  - The first version never brought the sidebar back. The context consumer reports `undefined` as the element disconnects, which cleared the stored context before `disconnectedCallback` could switch visual mode off. Fixed by switching off before `super.disconnectedCallback()` and ignoring `undefined`.
- [ ] An unsaved edit in Content shows up in Visual editor. After switching back, Content still has it, and Save & Publish saves it.
- [ ] Culture variant (da-DK) and split view (en-US + da-DK).
