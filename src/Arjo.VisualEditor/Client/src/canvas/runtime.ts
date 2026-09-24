/**
 * The canvas runtime (#17): injected into render-session pages (MarkerInjectionMiddleware), framework-free.
 * - Resolves the edit-mode markers (ADR 0002) into selectable targets.
 * - Hover outlines and labels; click selects the innermost target; the breadcrumb (or Escape) selects parent blocks.
 * - Talks to the backoffice over the protocol (docs/protocol.md): ready, hover, select, rendered; render,
 *   setSelection, highlight, setReadonly.
 * - Inline editing of plain text properties (#20, inline-edit.ts): double-click, or Enter on the selection. Rich text
 *   (#57, rich-text-edit.ts) the same way, with the backoffice's own editor mounted on the element.
 * - A toolbar on the selected block (#25): move up/down, duplicate, delete, settings (the host changes the document).
 * - Drag and drop of Block List (#26, drag.ts) and Block Grid blocks (#27, grid.ts, into and between areas): a handle
 *   on hovered and selected blocks, a drop line, autoscroll near the edges; Alt+Up/Down moves the selected block from
 *   the keyboard. Grid blocks can also be resized: a handle on the selected block's right edge changes its column span.
 * - Adding blocks (#28): "+" buttons on a hovered or selected block's top and bottom edges, and a placeholder in every
 *   empty grid area (also a drop target while dragging); the host opens the block catalogue.
 * - Live re-render (#18): a `render` message patches the newer page in (patch.ts) rather than reloading, then
 *   re-resolves the markers and keeps the selection, scroll position and focus.
 * Only active inside the visual editor (a nonce in the URL fragment); opening a render URL directly just shows the page.
 */
import {
	connectToHost,
	readNonce,
	type BlockPosition,
	type CanvasChannel,
	type HostMessage,
	type TargetRef,
} from '../protocol/index.js';
import { readManifest, resolveMarkers } from './markers.js';
import { InlineEditor, inlineEditableElement } from './inline-edit.js';
import { RichTextEditState } from './rich-text-edit.js';
import { guardNavigation } from './navigation.js';
import { CanvasOverlay, unionRect, type BlockTool } from './overlay.js';
import { BLOCK_LIST, blockListsOf, dropSpotAt, type DropSpot } from './drag.js';
import { BLOCK_GRID, containerOf, gridContainersOf, gridDropSpotAt, spanAt } from './grid.js';
import { fetchRender, patchDocument } from './patch.js';
import { TargetIndex, type CanvasTarget } from './targets.js';

export interface CanvasRuntime {
	/** Rebuilt after every live re-render. */
	readonly index: TargetIndex;
	overlay: CanvasOverlay;
	select(target: CanvasTarget | null): void;
	/** Show a selection made by the host, without reporting it back; `reveal` scrolls it into view. */
	showSelection(target: CanvasTarget | null, reveal?: boolean): void;
	/**
	 * Shows the host's selection by reference. When it isn't on the page yet (a block just added), it is selected once
	 * a re-render brings it.
	 */
	showSelectionOf(ref: TargetRef | null, reveal?: boolean): void;
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

	const overlay = new CanvasOverlay(doc, {
		onBreadcrumb: (target) => select(target),
		blockTools: (target) => blockTools(target),
		onBlockTool: (target, action) => channel?.send({ type: 'blockAction', blockKey: target.ref.ownerKey, action }),
		draggable: (target) =>
			!readonly && !editing() && (target.block?.editorAlias === BLOCK_LIST || target.block?.editorAlias === BLOCK_GRID),
		onDragStart: (target, event) => startDrag(target, event),
		resizable: (target) => !readonly && !editing() && target.block?.editorAlias === BLOCK_GRID,
		onResizeStart: (target, event) => startResize(target, event),
		insertable: (target) => !readonly && !editing() && !drag && isMovable(target),
		onInsert: (target, where) => {
			const at = positionBeside(target, where);
			if (at) channel?.send({ type: 'blockInsertRequest', at });
		},
	});

	/** The position just before or after a block, in its list or grid container. */
	function positionBeside(target: CanvasTarget, where: 'before' | 'after'): BlockPosition | null {
		const block = target.block;
		if (!block) return null;
		const at = where === 'before' ? block.index : block.index + 1;
		if (block.editorAlias !== BLOCK_GRID) {
			return { ownerKey: block.ownerKey, propertyAlias: block.propertyAlias, areaKey: null, index: at };
		}
		return {
			ownerKey: block.ownerKey,
			propertyAlias: block.propertyAlias,
			areaKey: block.areaKey,
			index: at,
			areaOwnerKey: block.areaOwnerKey,
			areaAlias: containerOf(target, gridContainersOf(index.targets))?.areaAlias ?? null,
		};
	}

	/** Height given to an empty grid area, so it can be seen, clicked and dropped on. */
	const EMPTY_AREA_HEIGHT = 56;

	/**
	 * Placeholders in empty grid areas (#28): an empty area renders with no height, so it gets one (on the page, in
	 * edit mode only; a re-render resets it, and this runs again) and a "+ Add block" button.
	 */
	function refreshPlaceholders() {
		const empty = readonly ? [] : gridContainersOf(index.targets).filter((c) => c.areaOwnerKey && !c.blocks.length);
		for (const container of empty) {
			const element = container.element as HTMLElement;
			if (element.getBoundingClientRect().height < EMPTY_AREA_HEIGHT)
				element.style.minHeight = `${EMPTY_AREA_HEIGHT}px`;
		}
		overlay.setPlaceholders(
			empty.map((container) => ({
				element: container.element,
				label: 'Add block',
				onInsert: () =>
					channel?.send({
						type: 'blockInsertRequest',
						at: {
							ownerKey: container.ownerKey,
							propertyAlias: container.propertyAlias,
							areaKey: null,
							index: 0,
							areaOwnerKey: container.areaOwnerKey,
							areaAlias: container.areaAlias,
						},
					}),
			})),
		);
	}

	/** Where a dragged block would drop: in a Block List for list blocks, in a grid's root or area for grid blocks. */
	function spotFor(target: CanvasTarget, x: number, y: number): DropSpot | null {
		return target.block?.editorAlias === BLOCK_GRID
			? gridDropSpotAt(x, y, target, gridContainersOf(index.targets), index.targets)
			: dropSpotAt(x, y, target, blockListsOf(index.targets), index.targets);
	}

	/**
	 * Resizing a grid block by its right-edge handle (#27): previews the new column span in whole columns of its
	 * container and sends it on release; the host snaps it to the spans the block type allows.
	 */
	function startResize(target: CanvasTarget, event: PointerEvent) {
		if (drag || readonly || editing()) return;
		const container = containerOf(target, gridContainersOf(index.targets));
		const box = unionRect(target.elements);
		if (!container || !box) return;
		const win = doc.defaultView!;
		const from = target.block?.columnSpan ?? container.columns;
		let span = from;
		const column = container.element.getBoundingClientRect().width / container.columns;
		doc.documentElement.style.setProperty('cursor', 'col-resize');
		doc.documentElement.style.setProperty('user-select', 'none');

		const preview = () =>
			overlay.setResizePreview({
				left: box.left,
				top: box.top,
				width: span * column,
				height: box.height,
				label: `${span} / ${container.columns} columns`,
			});
		const onMove = (e: PointerEvent) => {
			span = spanAt(e.clientX, box, container);
			preview();
		};
		const end = (apply: boolean) => {
			win.removeEventListener('pointermove', onMove, true);
			win.removeEventListener('pointerup', onUp, true);
			win.removeEventListener('pointercancel', onCancel, true);
			win.removeEventListener('keydown', onKey, true);
			doc.documentElement.style.removeProperty('cursor');
			doc.documentElement.style.removeProperty('user-select');
			overlay.setResizePreview(null);
			swallowClick = true;
			setTimeout(() => (swallowClick = false));
			if (apply && span !== from) {
				channel?.send({ type: 'blockResize', blockKey: target.ref.ownerKey, columnSpan: span });
			}
		};
		const onUp = () => end(true);
		const onCancel = () => end(false);
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			e.stopPropagation();
			end(false);
		};
		win.addEventListener('pointermove', onMove, true);
		win.addEventListener('pointerup', onUp, true);
		win.addEventListener('pointercancel', onCancel, true);
		win.addEventListener('keydown', onKey, true);
		onMove(event);
	}

	/** A block being dragged by its handle (#26). */
	let drag: { target: CanvasTarget; spot: DropSpot | null; x: number; y: number; scroll: number } | null = null;
	/** The click that ends a drag isn't a click on the page. */
	let swallowClick = false;

	/** Distance from the top/bottom of the page's viewport where a drag scrolls it, and the fastest it scrolls. */
	const AUTOSCROLL_EDGE = 56;
	const AUTOSCROLL_MAX = 18;

	function startDrag(target: CanvasTarget, event: PointerEvent) {
		if (drag || readonly || editing()) return;
		const win = doc.defaultView!;
		drag = { target, spot: null, x: event.clientX, y: event.clientY, scroll: 0 };
		hover(null);
		overlay.setDragging(target);
		doc.documentElement.style.setProperty('cursor', 'grabbing');
		doc.documentElement.style.setProperty('user-select', 'none');

		const update = () => {
			if (!drag) return;
			drag.spot = spotFor(drag.target, drag.x, drag.y);
			overlay.setDropLine(drag.spot?.line ?? null);
		};
		const autoscroll = () => {
			if (!drag) return;
			const height = win.innerHeight;
			const speed =
				drag.y < AUTOSCROLL_EDGE
					? -AUTOSCROLL_MAX * (1 - drag.y / AUTOSCROLL_EDGE)
					: drag.y > height - AUTOSCROLL_EDGE
						? AUTOSCROLL_MAX * (1 - (height - drag.y) / AUTOSCROLL_EDGE)
						: 0;
			if (speed) {
				win.scrollBy(0, speed);
				update();
			}
			drag.scroll = win.requestAnimationFrame(autoscroll);
		};
		const onMove = (e: PointerEvent) => {
			if (!drag) return;
			drag.x = e.clientX;
			drag.y = e.clientY;
			update();
		};
		const end = (drop: boolean) => {
			if (!drag) return;
			const { target: dragged, spot, scroll } = drag;
			drag = null;
			win.cancelAnimationFrame(scroll);
			win.removeEventListener('pointermove', onMove, true);
			win.removeEventListener('pointerup', onUp, true);
			win.removeEventListener('pointercancel', onCancel, true);
			win.removeEventListener('keydown', onKey, true);
			win.removeEventListener('blur', onCancel);
			doc.documentElement.style.removeProperty('cursor');
			doc.documentElement.style.removeProperty('user-select');
			overlay.setDropLine(null);
			overlay.setDragging(null);
			if (drop && spot) {
				swallowClick = true;
				setTimeout(() => (swallowClick = false));
				channel?.send({ type: 'blockMove', blockKey: dragged.ref.ownerKey, to: spot.to });
			}
		};
		const onUp = () => end(true);
		const onCancel = () => end(false);
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			e.stopPropagation();
			end(false);
		};
		win.addEventListener('pointermove', onMove, true);
		win.addEventListener('pointerup', onUp, true);
		win.addEventListener('pointercancel', onCancel, true);
		win.addEventListener('keydown', onKey, true);
		win.addEventListener('blur', onCancel);
		update();
		drag.scroll = win.requestAnimationFrame(autoscroll);
	}

	/**
	 * The block toolbar's buttons for a block, from where it sits (#24): list and grid blocks move and duplicate; rich
	 * text blocks sit in the markup, so they only get their settings.
	 */
	function blockTools(target: CanvasTarget): BlockTool[] | null {
		const block = target.block;
		if (readonly || !block) return null;
		const tools: BlockTool[] = [];
		if (block.editorAlias === 'Umbraco.BlockList' || block.editorAlias === 'Umbraco.BlockGrid') {
			const last = Math.max(
				...index.targets
					.map((t) => t.block)
					.filter(
						(b) =>
							b &&
							b.editorAlias === block.editorAlias &&
							b.propertyAlias === block.propertyAlias &&
							b.ownerKey === block.ownerKey &&
							b.areaKey === block.areaKey &&
							b.areaOwnerKey === block.areaOwnerKey,
					)
					.map((b) => b!.index),
			);
			tools.push(
				{ action: 'moveUp', label: 'Move up', disabled: block.index === 0 },
				{ action: 'moveDown', label: 'Move down', disabled: block.index >= last },
				{ action: 'duplicate', label: 'Duplicate' },
			);
		}
		if (block.settingsKey) tools.push({ action: 'settings', label: 'Settings' });
		if (block.editorAlias !== 'Umbraco.RichText') tools.push({ action: 'delete', label: 'Delete' });
		return tools;
	}
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

	/** The selection the host wants but the page doesn't show yet (e.g. a block just duplicated). */
	let awaited: TargetRef | null = null;

	function select(target: CanvasTarget | null, notify = true) {
		selected = target;
		awaited = null;
		overlay.setSelection(target, target ? index.ancestorsOf(target) : []);
		if (notify) channel?.send({ type: 'select', target: target?.ref ?? null });
	}

	function hover(target: CanvasTarget | null) {
		if (target === hovered) return;
		hovered = target;
		overlay.setHover(target);
		channel?.send({ type: 'hover', target: target?.ref ?? null });
	}

	/**
	 * A draggable block's hover reaches a little beyond it (more on the left, where its handle sits), so the pointer
	 * can travel from the block to the handle across the page's margin without the handle disappearing.
	 */
	const HOVER_SLOP = { left: 32, right: 8, top: 8, bottom: 8 };

	/**
	 * What to hover when the pointer moves onto `next` (the innermost target under it, or null): `next`, unless it is
	 * outside every block (or one of the blocks around what's hovered) and the pointer is still within the slop of a
	 * draggable block around what's hovered; then that block, so its handle stays in reach.
	 */
	function hoverTarget(next: CanvasTarget | null, x: number, y: number): CanvasTarget | null {
		if (!hovered || next === hovered) return next;
		const around = [hovered, ...index.ancestorsOf(hovered)];
		if (next && !around.includes(next)) return next;
		for (const candidate of around) {
			if (candidate.ref.kind !== 'Block' || !isMovable(candidate)) continue;
			const r = unionRect(candidate.elements);
			if (
				r &&
				x >= r.left - HOVER_SLOP.left &&
				x <= r.right + HOVER_SLOP.right &&
				y >= r.top - HOVER_SLOP.top &&
				y <= r.bottom + HOVER_SLOP.bottom
			) {
				return candidate;
			}
		}
		return next;
	}

	/** Blocks that can be dragged: Block List and Block Grid blocks. */
	function isMovable(target: CanvasTarget) {
		return target.block?.editorAlias === BLOCK_LIST || target.block?.editorAlias === BLOCK_GRID;
	}

	const onPointerOver = (event: PointerEvent) => {
		// Over our own overlay (a drag handle, the toolbar): keep what's hovered, so its handle stays.
		if (event.target === overlay.host || drag) return;
		if (readonly || editing()?.contains(event.target as Node)) return;
		hover(hoverTarget(index.targetAt(event.target as Element), event.clientX, event.clientY));
	};
	const onPointerLeave = () => hover(null);
	const onClick = (event: MouseEvent) => {
		if (readonly || event.button !== 0) return;
		if (swallowClick) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		// Clicks inside the text being edited place the caret.
		if (editing()?.contains(event.target as Node)) return;
		const target = index.targetAt(event.target as Element);
		if (!target) {
			// A click on the page outside rich text being edited finishes it (another target just selects that).
			if (richText.active) {
				event.preventDefault();
				richText.finish();
			}
			return;
		}
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
		// Keyboard alternative to dragging (#26): Alt+Up/Down moves the selected block among its siblings.
		if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
			const action = event.key === 'ArrowUp' ? 'moveUp' : 'moveDown';
			if (blockTools(selected)?.some((t) => t.action === action && !t.disabled)) {
				event.preventDefault();
				channel?.send({ type: 'blockAction', blockKey: selected.ref.ownerKey, action });
			}
			return;
		}
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
		const selectedRef = selected?.ref ?? awaited;
		selected = null;
		const found = index.find(selectedRef);
		select(found, false);
		if (!found) awaited = selectedRef;
		hovered = null;
		overlay.setHover(null);
		overlay.setHighlight(index.find(highlighted));
		showErrors();
		refreshPlaceholders();
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
	refreshPlaceholders();

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
		showSelectionOf(ref, reveal) {
			const target = index.find(ref);
			this.showSelection(target, reveal);
			if (!target) awaited = ref;
		},
		setErrors(list) {
			errors = list;
			showErrors();
		},
		setReadonly(value) {
			readonly = value;
			refreshPlaceholders();
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
			runtime.showSelectionOf(message.target, message.reveal);
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
			runtime.overlay.setEditing(message.active);
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
