/**
 * The canvas runtime (#17): injected into render-session pages (MarkerInjectionMiddleware), framework-free.
 * - Resolves the edit-mode markers (ADR 0002) into selectable targets.
 * - Hover outlines and labels; click selects the innermost target; the breadcrumb (or Escape) selects parent blocks.
 * - Talks to the backoffice over the protocol (docs/protocol.md): ready, hover, select, rendered; render,
 *   setSelection, highlight, setReadonly.
 * - Inline editing of plain text properties (#20, inline-edit.ts): double-click, or Enter on the selection. Rich text
 *   (#57, rich-text-edit.ts) the same way, with the backoffice's own editor mounted on the element.
 * - Live re-render (#18): a `render` message patches the newer page in (patch.ts) rather than reloading, then
 *   re-resolves the markers and keeps the selection, scroll position and focus.
 * Only active inside the visual editor (a nonce in the URL fragment); opening a render URL directly just shows the page.
 */
import { connectToHost, readNonce, type CanvasChannel, type HostMessage, type TargetRef } from '../protocol/index.js';
import { readManifest, resolveMarkers } from './markers.js';
import { InlineEditor, inlineEditableElement } from './inline-edit.js';
import { RichTextEditState } from './rich-text-edit.js';
import { guardNavigation } from './navigation.js';
import { CanvasOverlay } from './overlay.js';
import { fetchRender, patchDocument } from './patch.js';
import { TargetIndex, type CanvasTarget } from './targets.js';

export interface CanvasRuntime {
	/** Rebuilt after every live re-render. */
	readonly index: TargetIndex;
	overlay: CanvasOverlay;
	select(target: CanvasTarget | null): void;
	/** Show a selection made by the host, without reporting it back; `reveal` scrolls it into view. */
	showSelection(target: CanvasTarget | null, reveal?: boolean): void;
	/** Validation errors to mark (#23). */
	setErrors(errors: Array<{ target: TargetRef; message: string }>): void;
	/** Read-only (e.g. no Update permission, #31): no hover or selection from the page. */
	setReadonly(readonly: boolean): void;
	setHighlight(target: TargetRef | null): void;
	/** Editing text in place (#20). */
	readonly inline: InlineEditor;
	/** Editing rich text in place (#57). */
	readonly richText: RichTextEditState;
	/** Patches a newer render (render-session URL) into the page. Resolves false if it was superseded or failed. */
	render(url: string): Promise<boolean>;
	destroy(): void;
}

/** Starts the runtime against `doc` and `channel`. Exported for tests; the page entry point is `start()` below. */
export function createRuntime(doc: Document, channel: Pick<CanvasChannel, 'send'> | null): CanvasRuntime | null {
	let manifest = readManifest(doc);
	if (!manifest) return null;

	let index = new TargetIndex(resolveMarkers(manifest, doc));
	let selected: CanvasTarget | null = null;
	let hovered: CanvasTarget | null = null;
	let highlighted: TargetRef | null = null;
	let errors: Array<{ target: TargetRef; message: string }> = [];
	let readonly = false;
	/** The render in flight; a newer `render` aborts it. */
	let pending: AbortController | null = null;
	/** A render that arrived while text was being edited in place; patched in once editing ends. */
	let deferredRender: string | null = null;

	const overlay = new CanvasOverlay(doc, { onBreadcrumb: (target) => select(target) });
	/** Editing ended: patch in any render that waited for it. */
	const catchUp = () => {
		if (!deferredRender) return;
		const url = deferredRender;
		deferredRender = null;
		void render(url);
	};
	const inline = new InlineEditor(doc, (message) => channel?.send(message), catchUp);
	const richText = new RichTextEditState((message) => channel?.send(message), catchUp);
	/** Something is being edited in place: the element, whose events belong to the editor. */
	const editing = () => inline.element ?? richText.element;

	/** Asks to edit `target` in place; false when it isn't plain text shown as it is stored. */
	function requestInlineEdit(target: CanvasTarget | null, from?: Node | null) {
		const element = inlineEditableElement(target, from);
		if (!target || !element) return false;
		inline.request(target, element);
		return true;
	}

	function select(target: CanvasTarget | null, notify = true) {
		selected = target;
		overlay.setSelection(target, target ? index.ancestorsOf(target) : []);
		if (notify) channel?.send({ type: 'select', target: target?.ref ?? null });
	}

	function hover(target: CanvasTarget | null) {
		if (target === hovered) return;
		hovered = target;
		overlay.setHover(target);
		channel?.send({ type: 'hover', target: target?.ref ?? null });
	}

	const onPointerOver = (event: PointerEvent) => {
		if (readonly || editing()?.contains(event.target as Node)) return;
		hover(index.targetAt(event.target as Element));
	};
	const onPointerLeave = () => hover(null);
	const onClick = (event: MouseEvent) => {
		if (readonly || event.button !== 0) return;
		// Clicks inside the text being edited place the caret.
		if (editing()?.contains(event.target as Node)) return;
		const target = index.targetAt(event.target as Element);
		if (!target) return;
		// Selecting, not following links or triggering the site's own click handlers.
		event.preventDefault();
		event.stopPropagation();
		select(target);
	};
	const onDoubleClick = (event: MouseEvent) => {
		if (readonly || editing()) return;
		const target = index.targetAt(event.target as Element);
		if (!requestInlineEdit(target, event.target as Node) && !richText.request(target)) return;
		event.preventDefault();
		event.stopPropagation();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (!selected || editing() || readonly) return;
		if (event.key === 'Escape') select(index.ancestorsOf(selected)[0] ?? null);
		else if (event.key === 'Enter' && (requestInlineEdit(selected) || richText.request(selected)))
			event.preventDefault();
	};

	doc.addEventListener('pointerover', onPointerOver, true);
	doc.documentElement.addEventListener('pointerleave', onPointerLeave);
	doc.addEventListener('click', onClick, true);
	doc.addEventListener('dblclick', onDoubleClick, true);
	doc.addEventListener('keydown', onKeyDown);

	/** Marks the errors whose targets are on the page (again after a re-render: elements change). */
	function showErrors() {
		const byTarget = new Map<CanvasTarget, string[]>();
		for (const error of errors) {
			const target = index.find(error.target);
			if (target) byTarget.set(target, [...(byTarget.get(target) ?? []), error.message]);
		}
		overlay.setErrors([...byTarget].map(([target, messages]) => ({ target, message: messages.join('\n') })));
	}

	const sendReady = () =>
		channel?.send({
			type: 'ready',
			documentKey: manifest!.documentKey,
			culture: manifest!.culture,
			targets: index.targets.map((t) => t.ref),
		});

	async function render(url: string): Promise<boolean> {
		pending?.abort();
		if (editing()) {
			// Patching would overwrite the text being typed; catch up when editing ends.
			deferredRender = url;
			return false;
		}
		const controller = (pending = new AbortController());
		let next: Document | null = null;
		try {
			next = await fetchRender(url, controller.signal);
		} catch {
			// Network error or aborted; handled below.
		}
		if (controller.signal.aborted) return false; // A newer render took over; it answers instead.
		pending = null;
		if (editing()) {
			// Editing started while this was being fetched.
			deferredRender = url;
			return false;
		}
		if (!next) {
			channel?.send({ type: 'rendered', url, ok: false });
			return false;
		}

		patchDocument(doc, next, (node) => node === overlay.host);
		manifest = readManifest(doc)!;
		index = new TargetIndex(resolveMarkers(manifest, doc));
		// Targets are identified by what they point at, so the same things stay selected (unless they're gone).
		const selectedRef = selected?.ref ?? null;
		selected = null;
		select(index.find(selectedRef), false);
		hovered = null;
		overlay.setHover(null);
		overlay.setHighlight(index.find(highlighted));
		showErrors();
		// A reload of the frame (or the navigation guard) should come back to this render, not the first one.
		try {
			doc.defaultView?.history.replaceState(null, '', url + (doc.defaultView?.location.hash ?? ''));
		} catch {
			// Not a same-origin URL for this document (e.g. an about:srcdoc test page); nothing to remember.
		}

		sendReady();
		channel?.send({ type: 'rendered', url, ok: true });
		return true;
	}

	sendReady();

	return {
		get index() {
			return index;
		},
		overlay,
		select: (target) => select(target),
		showSelection(target, reveal) {
			select(target, false);
			if (reveal && target?.elements[0]) target.elements[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
		},
		setErrors(list) {
			errors = list;
			showErrors();
		},
		setReadonly(value) {
			readonly = value;
			if (readonly) {
				hover(null);
				inline.cancel();
			}
		},
		setHighlight(ref) {
			highlighted = ref;
			overlay.setHighlight(index.find(ref));
		},
		render,
		inline,
		richText,
		destroy() {
			pending?.abort();
			inline.destroy();
			doc.removeEventListener('dblclick', onDoubleClick, true);
			doc.removeEventListener('pointerover', onPointerOver, true);
			doc.documentElement.removeEventListener('pointerleave', onPointerLeave);
			doc.removeEventListener('click', onClick, true);
			doc.removeEventListener('keydown', onKeyDown);
			overlay.destroy();
		},
	};
}

/** Applies a message from the backoffice to a running canvas. */
export function handleHostMessage(runtime: CanvasRuntime, message: HostMessage) {
	switch (message.type) {
		case 'setSelection':
			// The host is the source of truth; don't echo its selection back.
			runtime.showSelection(runtime.index.find(message.target), message.reveal);
			break;
		case 'setErrors':
			runtime.setErrors(message.errors);
			break;
		case 'highlight':
			runtime.setHighlight(message.target);
			break;
		case 'setReadonly':
			runtime.setReadonly(message.readonly);
			break;
		case 'render':
			void runtime.render(message.url);
			break;
		case 'beginInlineEdit':
			runtime.inline.begin(message);
			break;
		case 'richTextEditing':
			runtime.richText.setActive(message.target, message.active);
			break;
		// 'setDevice' is handled by the host (it sizes the frame).
	}
}

async function start() {
	// Keep the canvas on the page being edited (links, forms), even if markers don't resolve.
	guardNavigation();

	const nonce = readNonce();
	if (!nonce) return;

	let runtime: CanvasRuntime | null = null;
	let channel: CanvasChannel;
	try {
		channel = await connectToHost({
			nonce,
			onMessage: (message) => {
				if (runtime) handleHostMessage(runtime, message);
				// No markers (the template failed): nothing to patch into, so have the host reload the frame.
				else if (message.type === 'render') channel.send({ type: 'rendered', url: message.url, ok: false });
			},
		});
	} catch {
		return; // Not inside the visual editor.
	}
	runtime = createRuntime(document, channel);
}

void start();
