# Backoffice ↔ canvas protocol

This is how the backoffice (the **host**, which owns the iframe) talks to the rendered page inside it (the **canvas**).

- **Code:** `src/Arjo.VisualEditor/Client/src/protocol/`. Both bundles import the same module.
- **Tests:** `*.test.ts` next to the code. Run them with `npm test`.
- **Version:** `PROTOCOL_VERSION = 1`. Bump it on any breaking change; each side refuses a version it doesn't know.

## Connecting

```
host (backoffice)                                   canvas (iframe, render-session page)
─────────────────                                   ───────────────────────────────────
nonce = createNonce()
iframe.src = withNonce(renderUrl, nonce)  ───────►  nonce = readNonce()        (#uve-nonce=… fragment)
createHostChannel({ iframe, nonce, … })             connectToHost({ nonce, … })
                                          ◄───────  window.parent.postMessage(hello{nonce, version})
check: event.source === iframe.contentWindow          (repeated every 250 ms until answered, 5 s timeout)
       event.origin === expected origin
       nonce + version match
new MessageChannel()
iframe.contentWindow.postMessage(          ───────►  check: event.source === window.parent
  connect{nonce, version}, origin, [port2])                 event.origin === host origin
                                                            nonce + version match, port present
◄════════════════════ all further messages go over the private MessagePort ════════════════════►
```

- **Why the nonce is in the fragment:** fragments are never sent to the server, so the nonce doesn't show up in server logs or `Referer` headers.
- **Why a private port:** the site's own scripts run in the same iframe window, so they could `postMessage` to the parent. They never receive the port, so after the handshake they can't pose as the canvas.
- **Every page load reconnects.** When the frame loads a page, the handshake runs again and replaces the port. The host's `onConnect` should resend any state the canvas needs, such as the selection, the device width and read-only mode.
- **Re-renders are patched in, not loaded (#18).** Once a page has loaded normally, the host sends each newer render as `render`. The canvas fetches it, morphs it into the page (idiomorph) and answers `ready` then `rendered`. The port, selection, scroll position and focus all survive. If the canvas answers `rendered` with `ok: false` (the new render has no markers, e.g. the template threw), the host loads that URL into the frame instead.
- **Messages are validated at runtime** on both sides (`parseCanvasMessage` / `parseHostMessage`). Unknown types and malformed payloads are dropped and reported through `onInvalid`, never delivered.
- **Default origin:** render sessions are same-origin with the backoffice (ADR 0001), so both sides default to `location.origin`.

## Targets

Marker ids change on every render, so messages identify what they're about by a `TargetRef` (from ADR 0002):

```ts
{ kind: 'Property' | 'Block', ownerKey, ownerIsBlock, alias: string | null, culture: string | null }
```

- **`ownerKey`** is the document key, or a block's content key when `ownerIsBlock` is true.
- **Whole blocks** have `alias: null`.

Targets can also carry **display labels**, filled in from the document and element types. They aren't part of the identity:
- `label`: the property's name, or the block's content type name, e.g. "Caption" or "Image Row".
- `ownerLabel`: for a property inside a block, the block's type name.

Block positions use `{ ownerKey, propertyAlias, areaKey | null, index }`.

## Messages

### Canvas → host

| Type | Payload | Sent when |
|---|---|---|
| `ready` | `documentKey`, `culture`, `targets: TargetRef[]` | Markers resolved and connected (after every render) |
| `rendered` | `url`, `ok: boolean` | A `render` was patched in (`ok`), or couldn't be. A render that a newer one overtook gets no answer. |
| `hover` | `target \| null` | The pointer enters or leaves a target (#17) |
| `select` | `target \| null` | A target is clicked, or the selection is cleared |
| `inlineEditStart` | `target`, `text: string` | Double-click (or Enter on the selection) on a TextBox/TextArea shown as plain text; `text` is what the element shows (#20) |
| `inlineEdit` | `target`, `value: string` | The text being edited in place changed (debounced) |
| `inlineEditEnd` | `target`, `cancelled: boolean` | Editing in place ended: committed (blur, Enter) or cancelled (Escape) |
| `blockMove` | `blockKey`, `to: BlockPosition` | A block is dropped in a new position (#26/#27) |
| `blockInsertRequest` | `at: BlockPosition` | An insertion point "+" is clicked (#28) |
| `scroll` | `x`, `y` | The canvas scrolls (so the host can restore it after a re-render) |

### Host → canvas

| Type | Payload | Meaning |
|---|---|---|
| `render` | `url` | Patch in a newer render-session page (#18); answered by `rendered` |
| `highlight` | `target \| null` | Emphasise a target, e.g. while hovering its field in the side panel |
| `setSelection` | `target \| null` | The selected target (the host is the source of truth) |
| `setReadonly` | `readonly: boolean` | Turn editing affordances off or on (#31) |
| `beginInlineEdit` | `target`, `maxLength: number | null`, `multiline: boolean` | Go ahead with an `inlineEditStart`. Only sent when the text matches the stored value, the property is TextBox/TextArea and the user may edit it; otherwise the side panel opens. |
| `setDevice` | `width: number \| null` | Emulated viewport width in CSS px; `null` is full width (#16) |

## Status

The message *set* is the initial one from #12.
- **The canvas runtime** (`canvas/runtime.ts`, served as `canvas-runtime.js`, #17) sends `ready`, `rendered`, `hover`, `select` and the inline edit messages, and handles `render`, `setSelection`, `highlight`, `setReadonly` and `beginInlineEdit`.
- **The Visual editor view** handles `ready`, `rendered`, `select` and the inline edit messages, and sends `render`, `setSelection`, `setDevice` and `beginInlineEdit`.
- **Inline editing (#20):** while text is edited in place, the host writes each `inlineEdit` to the workspace but holds back re-renders, and the canvas defers any `render` it receives. Both catch up at `inlineEditEnd`. A cancelled edit puts back the value the host had when it sent `beginInlineEdit`.
- **Not used yet:** the block messages arrive with the issues listed above.

Add new messages here and in `messages.ts` together, with tests.
