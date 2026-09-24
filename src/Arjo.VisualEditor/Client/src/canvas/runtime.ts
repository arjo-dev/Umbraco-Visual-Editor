/**
 * The canvas runtime (#17): injected into render-session pages (MarkerInjectionMiddleware), framework-free.
 * - Resolves the edit-mode markers (ADR 0002) into selectable targets.
 * - Hover outlines and labels; click selects the innermost target; the breadcrumb (or Escape) selects parent blocks.
 * - Talks to the backoffice over the protocol (docs/protocol.md): ready, hover, select; setSelection, highlight,
 *   setReadonly.
 * Only active inside the visual editor (a nonce in the URL fragment); opening a render URL directly just shows the page.
 */
import { connectToHost, readNonce, type CanvasChannel, type HostMessage } from '../protocol/index.js';
import { readManifest, resolveMarkers } from './markers.js';
import { guardNavigation } from './navigation.js';
import { CanvasOverlay } from './overlay.js';
import { TargetIndex, type CanvasTarget } from './targets.js';

export interface CanvasRuntime {
	index: TargetIndex;
	overlay: CanvasOverlay;
	select(target: CanvasTarget | null): void;
	/** Show a selection made by the host, without reporting it back. */
	showSelection(target: CanvasTarget | null): void;
	/** Read-only (e.g. no Update permission, #31): no hover or selection from the page. */
	setReadonly(readonly: boolean): void;
	destroy(): void;
}

/** Starts the runtime against `doc` and `channel`. Exported for tests; the page entry point is `start()` below. */
export function createRuntime(doc: Document, channel: Pick<CanvasChannel, 'send'> | null): CanvasRuntime | null {
	const manifest = readManifest(doc);
	if (!manifest) return null;

	const index = new TargetIndex(resolveMarkers(manifest, doc));
	let selected: CanvasTarget | null = null;
	let hovered: CanvasTarget | null = null;
	let readonly = false;

	const overlay = new CanvasOverlay(doc, { onBreadcrumb: (target) => select(target) });

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
		if (!readonly) hover(index.targetAt(event.target as Element));
	};
	const onPointerLeave = () => hover(null);
	const onClick = (event: MouseEvent) => {
		if (readonly || event.button !== 0) return;
		const target = index.targetAt(event.target as Element);
		if (!target) return;
		// Selecting, not following links or triggering the site's own click handlers.
		event.preventDefault();
		event.stopPropagation();
		select(target);
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== 'Escape' || !selected) return;
		select(index.ancestorsOf(selected)[0] ?? null);
	};

	doc.addEventListener('pointerover', onPointerOver, true);
	doc.documentElement.addEventListener('pointerleave', onPointerLeave);
	doc.addEventListener('click', onClick, true);
	doc.addEventListener('keydown', onKeyDown);

	channel?.send({
		type: 'ready',
		documentKey: manifest.documentKey,
		culture: manifest.culture,
		targets: index.targets.map((t) => t.ref),
	});

	return {
		index,
		overlay,
		select: (target) => select(target),
		showSelection: (target) => select(target, false),
		setReadonly(value) {
			readonly = value;
			if (readonly) hover(null);
		},
		destroy() {
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
			runtime.showSelection(runtime.index.find(message.target));
			break;
		case 'highlight':
			runtime.overlay.setHighlight(runtime.index.find(message.target));
			break;
		case 'setReadonly':
			runtime.setReadonly(message.readonly);
			break;
		// 'render' and 'setDevice' are handled by the host (it loads the URL and sizes the frame).
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
			},
		});
	} catch {
		return; // Not inside the visual editor.
	}
	runtime = createRuntime(document, channel);
}

void start();
