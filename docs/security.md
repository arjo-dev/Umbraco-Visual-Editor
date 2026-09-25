# Security

This is how the Visual editor keeps unsaved content, the backoffice and the site safe. It was reviewed in #34 against Umbraco 18.2. Change it when the render endpoint, the frame or the protocol change.

## What there is to protect

- **Unsaved and unpublished content.** Render sessions carry an editor's unsaved values and render the document's draft.
- **The backoffice session.** The canvas frame is on the same origin as the backoffice.
- **The live site.** Rendering must never save, publish, upload or cache anything that live visitors or the real save would see.

## Render sessions (ADR 0001)

| Check | Where |
|---|---|
| **Creating a session.** The user must be signed in to the backoffice and have access to the Content section (`ArjoVisualEditorApiControllerBase`). They also need Browse permission on the document, and the `VisualEditor` settings must allow its document type (#32). | `RenderSessionController` |
| **Unsaved values need Update permission.** A user who may only browse the document gets a session for the document as saved; the values and names they sent are ignored. Otherwise a crafted value, such as a picker pointing outside their start nodes, could show them content they aren't allowed to see. Users who may update the document could save and preview such a value anyway. | `RenderSessionController` |
| **The token.** It's a random GUID, held in the distributed cache and forgotten 10 minutes after last use. | `RenderSessionStore` |
| **Only the session's user can render it.** The render URL alone isn't enough. The page is a front-end request, so it has no backoffice token, and Umbraco's sign-in cookie only lasts for the sign-in itself. So creating a session also sets a cookie of our own, like Umbraco's preview cookie. It's `HttpOnly`, `SameSite=Strict` and only sent to `/__visual-editor/`, and it holds a random pass for the user. Render requests must carry the pass of the session's user. For anyone else, even with a leaked URL (a site's analytics, browser history, a screenshot), the page is a 404. | `RenderViewerCookie`, `RenderSessionContentFinder` |
| **Render responses.** They're sent `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` (the token isn't passed on to the page's images, fonts or links) and `Content-Security-Policy: frame-ancestors 'self'`. That last one is added alongside any policy the site sends, and policies combine. | `MarkerInjectionMiddleware` |

## Rendering never changes anything

- **The document.** The overlay is built in memory from the draft (`OverlayContentBuilder`). Nothing is saved or published.
- **Converting values.** Values are converted as saving would (`IDataValueEditor.FromEditor`), with two safeguards:
  - **Uploads not yet saved are left out** (`PendingUploads`). Upload field and Image Cropper values drop their `temporaryFileId`, and rich text drops its pasted images' `data-tmpimg`. Otherwise converting them would move the file into media storage and delete the temporary file (so the real save would find it gone), or create a media item on every render. The page shows what the editor shows (the image's `src`).
  - **There's no current value** (`currentValue: null`). Some editors tidy up with it: an upload field deletes the file it replaces.
  - A value that can't be converted is logged and rendered as saved, rather than failing the page.
- **Caches.** Render requests neither read nor fill the partial view cache (`EditModeRuntimeCache`). Otherwise live visitors could be served output with unsaved values and markers in it.

## The frame

- **Sandbox.** The canvas iframe is `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"`. It leaves out `allow-top-navigation`, so the site's scripts can't navigate the backoffice away.
- **Navigating away.** If the frame goes anywhere other than a render page, the render page is loaded again (`visual-editor-canvas.element.ts`). The canvas runtime stops link clicks and form submits (`navigation.ts`).
- **Patching in re-renders.** The canvas only fetches and patches in render-session pages on its own origin, whatever it's asked to load (`isRenderUrl`).

## Messaging (docs/protocol.md)

- **Handshake.** The host puts a random nonce in the render URL's fragment. Fragments are never sent to the server, so the nonce isn't in logs or `Referer` headers.
- **What each side accepts.**
  - The host accepts a `hello` only from its own iframe (`event.source`), from its own origin, with that nonce and the protocol version.
  - The canvas accepts `connect` only from `window.parent`, from the same origin, with the same nonce.
- **After that.** All messages go over a private `MessageChannel` port. No other window or frame can post on it.
- **Validation.** Every message is checked against the protocol before it's acted on (`parseCanvasMessage` / `parseHostMessage`). Unknown or malformed messages are dropped.

## Content in the canvas

- **Text edited in place** is `contenteditable="plaintext-only"`, and only text is sent (#20). The template encodes it when it renders.
- **Rich text** is edited with the backoffice's own Tiptap editor. It goes through the same property editor, and the same `IHtmlSanitizer`, as the Content tab.
- **Markers.** Stega markers are zero-width characters only, and comment markers are `<!--uve:b:123-->` with numeric ids. The marker manifest is JSON with `</` escaped, inside a `type="application/json"` script.
- **The overlay's labels and messages** (content type names, validation messages) are written with `textContent`. The only `innerHTML` is the overlay's own fixed styles and icons.

## Risks that remain

- **The site's scripts can reach the backoffice.** The frame shows the site's own pages on the backoffice's origin, with scripts allowed. Those scripts, including third-party ones (analytics, chat widgets), can reach `window.parent`: the sandbox isn't a boundary between them. Umbraco's own preview has the same exposure. Only put scripts on the site that you'd trust in the backoffice. You can also keep them out of edit mode: render sessions have paths starting `/__visual-editor/render/`.
- **A site's strict Content Security Policy can block the canvas.** If the policy only allows scripts with a nonce or hash, it blocks the canvas script that's added to render pages. The page then shows, but can't be edited visually. Allow `/App_Plugins/ArjoVisualEditor/` in `script-src`.
- **Request size.** A session holds the values sent, within the site's request size limit, for up to 10 minutes. Only signed-in backoffice users can create one.
