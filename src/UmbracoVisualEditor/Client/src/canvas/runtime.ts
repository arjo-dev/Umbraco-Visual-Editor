/**
 * The canvas runtime (#17): injected into render-session pages (MarkerInjectionMiddleware), framework-free.
 * - Resolves the edit-mode markers (ADR 0002) into selectable targets.
 * - Hover outlines and labels; click selects the innermost target; the breadcrumb (or Escape) selects parent blocks.
 * - Talks to the backoffice over the protocol (docs/protocol.md): ready, hover, select, rendered; render,
 *   setSelection, highlight, setReadonly.
 * - Inline editing of plain text properties (#20, inline-edit.ts): double-click, or Enter on the selection. Rich text
 *   (#57, rich-text-edit.ts) the same way, with the backoffice's own editor mounted on the element. A site can turn both
 *   off (VisualEditor:EnablePropertyLevelEditing, in the manifest): then they open the property in the side panel.
 * - Overlay mode (VisualEditor:EditorMode Overlay, the host's `setOpenOnClick`): a click (or a breadcrumb, or Enter)
 *   selects and also asks the host to open the target's editor (`openEditor`: Umbraco's block overlay); nothing is
 *   edited on the page, and double-click does nothing (the click already opened it). The canvas works per block then
 *   (represent()): the hovered block gets the toolbar, and a nested block's toolbar has a "parent block" button that
 *   lifts the hover to the block around it, so a layout covered by its children can still be moved or deleted.
 * - A toolbar on the selected block (#25): move up/down, duplicate, delete, settings (the host changes the document).
 * - Drag and drop of Block List (#26, drag.ts) and Block Grid blocks (#27, grid.ts, into and between areas): a handle
 *   on hovered and selected blocks, a drop line, autoscroll near the edges; Alt+Up/Down moves the selected block from
 *   the keyboard. Grid blocks can also be resized: a handle on the selected block's right edge changes its column span.
 * - Adding blocks (#28): "+" buttons on a hovered or selected block's top and bottom edges, and a placeholder in every
 *   empty grid area (also a drop target while dragging) and empty block property a template marks (#97); the host
 *   opens the block catalogue. Placeholders are a line on hover, or boxes with room on the page (setShowEmpty).
 * - Live re-render (#18): a `render` message patches the newer page in (patch.ts) rather than reloading, then
 *   re-resolves the markers and keeps the selection, scroll position and focus. The page's scripts get events before
 *   and after it (BEFORE_RENDER_EVENT, RENDERED_EVENT), to set themselves up again.
 * Only active inside the visual editor (a nonce in the URL fragment); opening a render URL directly just shows the page.
 */
import {
	connectToHost,
	DEFAULT_CANVAS_STRINGS,
	format,
	historyAction,
	readNonce,
	type BlockPosition,
	type CanvasChannel,
	type CanvasStrings,
	type HostMessage,
	type TargetRef,
} from '../protocol/index.js';
import { readEmptyBlockSpots, readManifest, resolveMarkers } from './markers.js';
import { InlineEditor, inlineEditableElement } from './inline-edit.js';
import { RichTextEditState } from './rich-text-edit.js';
import { guardNavigation } from './navigation.js';
import { CanvasOverlay, unionRect, type BlockTool } from './overlay.js';
import { BLOCK_LIST, blockListsOf, dropSpotAt, type DropSpot } from './drag.js';
import { BLOCK_GRID, containerOf, gridContainersOf, gridDropSpotAt, spanAt } from './grid.js';
import { fetchRender, patchDocument } from './patch.js';
import { TargetIndex, targetLabel, type CanvasTarget } from './targets.js';

/**
 * Events on the page's `document` around a live re-render, for the site's scripts (docs/compatibility.md): tear down
 * before the new render is patched in, set up again after it. `detail.url` is the render's URL. Not on the first load:
 * the site's scripts run then as they always do.
 */
export const BEFORE_RENDER_EVENT = 'visual-editor:before-render';
export const RENDERED_EVENT = 'visual-editor:rendered';

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
	/**
	 * Read-only (#31: no Update permission, in the recycle bin, locked, no access to the language): things can still
	 * be hovered and selected (the side panel shows them, read-only), but nothing is edited from the page.
	 */
	setReadonly(readonly: boolean): void;
	/** Give empty places to add blocks to room on the page (#97), rather than a line on hover. */
	setShowEmpty(show: boolean): void;
	/** Overlay mode: clicks also open the target's editor, and nothing is edited on the page. */
	setOpenOnClick(open: boolean): void;
	setHighlight(target: TargetRef | null): void;
	/** The words to use, in the backoffice user's language (#35). */
	setStrings(strings: Partial<CanvasStrings>): void;
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
	/** Overlay mode (setOpenOnClick): selecting with the mouse, or Enter, also opens the target's editor in the host. */
	let openOnClick = false;
	let strings: CanvasStrings = DEFAULT_CANVAS_STRINGS;
	/** The render in flight; a newer `render` aborts it. */
	let pending: AbortController | null = null;
	/** A render that arrived while text was being edited in place; patched in once editing ends. */
	let deferredRender: string | null = null;

	const overlay = new CanvasOverlay(doc, {
		onBreadcrumb: (target) => {
			select(target);
			// Overlay mode: a parent block covered by its children can only be reached this way with the mouse.
			if (openOnClick) openEditor(target);
		},
		strings: () => strings,
		// A page property that doesn't vary, on a page shown in one of its languages: editing it changes them all (#30).
		note: (target) =>
			manifest?.culture && target.ref.kind === 'Property' && !target.ref.ownerIsBlock && target.ref.culture === null
				? strings.sharedAcrossLanguages
				: null,
		blockTools: (target) => blockTools(target),
		// Overlay mode: a click opens the block, so its tools must be reachable without selecting it.
		toolsOnHover: () => openOnClick,
		// Blocks only (ancestorsOf), nearest first.
		parentBlock: (target) => index.ancestorsOf(target)[0] ?? null,
		onParentBlock: (target) => lift(target),
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
	/** Height given to a block with nothing to show yet (e.g. one just added), so it can be seen and selected. */
	const EMPTY_BLOCK_HEIGHT = 64;

	/**
	 * A block that shows nothing yet: no text, no media, and no areas or blocks inside it (those have placeholders or
	 * content of their own). Its empty properties don't count.
	 */
	function isEmptyBlock(target: CanvasTarget): boolean {
		if (target.ref.kind !== 'Block' || !target.elements.length) return false;
		return target.elements.every(
			(el) =>
				!el.textContent?.trim() &&
				!el.querySelector('img, picture, video, iframe, svg, canvas, object, embed, .umb-block-grid__area') &&
				!index.targets.some(
					(t) =>
						t !== target && t.ref.kind === 'Block' && t.elements.some((inner) => el !== inner && el.contains(inner)),
				),
		);
	}

	/** Empty places get room on the page (the toolbar's toggle, #97); otherwise they leave the layout alone. */
	let showEmpty = false;
	/** Elements given a height for an empty place, and the inline min-height they had before. */
	const reserved = new Map<HTMLElement, string>();

	/**
	 * Placeholders in empty places blocks can be added to (#28): empty grid areas, and empty Block Lists and Grids a
	 * template marks with `Html.VisualEditorEmptyBlocks` (#97). They render with no height, so they show a line with a
	 * "+ Add block" button on hover; with `showEmpty` they get a height (on the page, in edit mode only; a re-render
	 * resets it, and this runs again) and a dashed box.
	 */
	function refreshPlaceholders() {
		for (const [element, minHeight] of reserved) element.style.minHeight = minHeight;
		reserved.clear();

		const areas = readonly ? [] : gridContainersOf(index.targets).filter((c) => c.areaOwnerKey && !c.blocks.length);
		const empty: Array<{ element: Element; at: BlockPosition; label?: string }> = [
			...areas.map((container) => ({
				element: container.element,
				at: {
					ownerKey: container.ownerKey,
					propertyAlias: container.propertyAlias,
					areaKey: null,
					index: 0,
					areaOwnerKey: container.areaOwnerKey,
					areaAlias: container.areaAlias,
				},
			})),
			...(readonly ? [] : readEmptyBlockSpots(doc)),
		];
		if (showEmpty) {
			for (const { element } of empty) {
				const el = element as HTMLElement;
				if (el.getBoundingClientRect().height >= EMPTY_AREA_HEIGHT) continue;
				reserved.set(el, el.style.minHeight);
				el.style.minHeight = `${EMPTY_AREA_HEIGHT}px`;
			}
		}
		// Blocks with nothing to show yet (e.g. one just added): say where their content is edited.
		const blank = readonly ? [] : index.targets.filter(isEmptyBlock);
		for (const target of blank) {
			const element = target.elements[0] as HTMLElement;
			if (element.getBoundingClientRect().height < EMPTY_BLOCK_HEIGHT)
				element.style.minHeight = `${EMPTY_BLOCK_HEIGHT}px`;
		}
		overlay.setPlaceholders([
			...blank.map((target) => ({
				element: target.elements[0],
				label: openOnClick ? strings.clickToEdit : strings.editInSidePanel,
			})),
			...empty.map(({ element, at, label }) => ({
				element,
				// An empty property says which it is ("Add block to Cards"), as a page can have several; areas don't.
				label: label ? format(strings.addBlockTo, label) : strings.addBlock,
				line: !showEmpty,
				onInsert: () => channel?.send({ type: 'blockInsertRequest', at }),
			})),
		]);
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
		if (!block) return null;
		// Read-only: nothing that changes the page; copying and looking at settings don't.
		if (readonly) {
			const tools: BlockTool[] = [];
			if (block.editorAlias !== 'Umbraco.RichText') tools.push({ action: 'copy', label: strings.copy });
			if (block.settingsKey) tools.push({ action: 'settings', label: strings.settings });
			return tools;
		}
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
				{ action: 'moveUp', label: strings.moveUp, disabled: block.index === 0 },
				{ action: 'moveDown', label: strings.moveDown, disabled: block.index >= last },
				{ action: 'duplicate', label: strings.duplicate },
			);
		}
		// Copy to the CMS clipboard (#29): blocks copied here can be pasted in the standard editor, and back.
		if (block.editorAlias !== 'Umbraco.RichText') tools.push({ action: 'copy', label: strings.copy });
		if (block.settingsKey) tools.push({ action: 'settings', label: strings.settings });
		if (block.editorAlias !== 'Umbraco.RichText') tools.push({ action: 'delete', label: strings.delete });
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

	/**
	 * Text and rich text can be edited on the page: not read-only, not overlay mode, and not turned off by the site
	 * (EnablePropertyLevelEditing).
	 */
	const editsInPlace = () => !readonly && !openOnClick && manifest?.propertyLevelEditing !== false;

	/** Asks the host to open `target`'s editor: the side panel, or in overlay mode Umbraco's block overlay. */
	const openEditor = (target: CanvasTarget) => channel?.send({ type: 'openEditor', target: target.ref });

	/** Asks to edit `target` in place; false when it isn't plain text shown as it is stored. */
	function requestInlineEdit(target: CanvasTarget | null, from?: Node | null) {
		const element = inlineEditableElement(target, from);
		if (!target || !element) return false;
		inline.request(target, element);
		return true;
	}

	/** The selection the host wants but the page doesn't show yet (e.g. a block just duplicated). */
	let awaited: TargetRef | null = null;

	/**
	 * Overlay mode works per block: a property inside a block (its content or its settings) stands for that block, as
	 * clicking it opens the block's overlay anyway. That way hovering it shows the block's frame and toolbar, so the
	 * block can be moved or deleted from the page. A property without a Block target around it (e.g. a template that
	 * prints a block's value without a partial) stands for itself, and so does every property outside overlay mode.
	 */
	function represent(target: CanvasTarget | null): CanvasTarget | null {
		if (!openOnClick || target?.ref.kind !== 'Property' || !target.ref.ownerIsBlock) return target;
		const key = target.ref.ownerKey;
		return (
			index.ancestorsOf(target).find((block) => block.ref.ownerKey === key || block.block?.settingsKey === key) ??
			target
		);
	}

	function select(next: CanvasTarget | null, notify = true) {
		// Every selection goes through here (mouse, keyboard, host, re-render), so this is the one place to map it.
		const target = represent(next);
		const changed = target !== selected;
		selected = target;
		awaited = null;
		// Screen readers hear what's selected (#35).
		if (changed)
			overlay.announce(
				target ? format(strings.selected, targetLabel(target.ref, strings.block)) : strings.nothingSelected,
			);
		overlay.setSelection(target, target ? index.ancestorsOf(target) : []);
		if (notify) channel?.send({ type: 'select', target: target?.ref ?? null });
	}

	/**
	 * Overlay mode: the block the hover was lifted to with the toolbar's "parent block" button. Its children are under
	 * the pointer, but while the pointer stays inside it, it keeps the hover (and the toolbar) and a click opens it.
	 * Only ever the hovered block: hovering anything else lets go of it (the selection stays).
	 */
	let lifted: CanvasTarget | null = null;

	/**
	 * Lifts the hover from `target` to the block around it, and selects that block (the "parent block" button, "Select
	 * X"). Selecting it too leaves one block active: otherwise a child selected earlier (the block whose overlay was just
	 * closed) keeps its selected box next to the lifted parent's. It selects without opening, like Escape; a click inside
	 * the lifted block opens it.
	 */
	function lift(target: CanvasTarget) {
		const parent = index.ancestorsOf(target)[0];
		if (!parent) return;
		lifted = parent;
		hover(parent);
		select(parent);
	}

	/** `target` is the lifted block or inside it: then that block is what the pointer is over. */
	function inLifted(target: CanvasTarget | null) {
		return !!lifted && !!target && (target === lifted || index.ancestorsOf(target).includes(lifted));
	}

	function hover(next: CanvasTarget | null) {
		const target = represent(next);
		if (target !== lifted) lifted = null;
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
		// First, before represent() would map a property to its own (inner) block.
		if (inLifted(next)) return lifted;
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
		if (editing()?.contains(event.target as Node)) return;
		hover(hoverTarget(index.targetAt(event.target as Element), event.clientX, event.clientY));
	};
	const onPointerLeave = () => hover(null);
	const onClick = (event: MouseEvent) => {
		if (event.button !== 0) return;
		if (swallowClick) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		// Clicks inside the text being edited place the caret.
		if (editing()?.contains(event.target as Node)) return;
		const under = index.targetAt(event.target as Element);
		// While lifted, what's outlined is what opens: the lifted block, not the child under the pointer.
		const target = inLifted(under) ? lifted : under;
		if (!target) {
			// A click on the page outside rich text being edited finishes it (another target just selects that).
			if (richText.active) {
				event.preventDefault();
				richText.finish();
			}
			// Anywhere else on the page clears the selection. No preventDefault: links there still work. Not our own overlay
			// (toolbar, "+", handles): its buttons act on the selection, and this capturing listener runs before theirs.
			if (selected && event.target !== overlay.host) select(null);
			return;
		}
		// Selecting, not following links or triggering the site's own click handlers.
		event.preventDefault();
		event.stopPropagation();
		select(target);
		// Overlay mode: read-only users too, Umbraco shows its overlay read-only. What's selected, i.e. the block a
		// property inside a block stands for.
		if (openOnClick && selected) openEditor(selected);
	};
	const onDoubleClick = (event: MouseEvent) => {
		if (openOnClick) {
			// The click before it already opened the editor; a second open would only fight the first.
			if (index.targetAt(event.target as Element)) {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}
		if (readonly || editing()) return;
		const target = index.targetAt(event.target as Element);
		if (!editsInPlace()) {
			// Editing on the page is turned off: a property opens its editor in the side panel instead.
			if (target?.ref.kind !== 'Property') return;
			openEditor(target);
		} else if (!requestInlineEdit(target, event.target as Node) && !richText.request(target)) return;
		event.preventDefault();
		event.stopPropagation();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		// Undo / redo (#33); text being edited has its own.
		const history = historyAction(event);
		if (history && !editing()) {
			event.preventDefault();
			if (!readonly) channel?.send({ type: 'history', action: history });
			return;
		}
		if (editing()) return;
		if (navigate(event)) return;
		if (!selected) return;
		if (event.key === 'Escape') {
			select(index.ancestorsOf(selected)[0] ?? null);
			return;
		}
		if (event.key === 'Enter' && !isPageField(event.target)) {
			event.preventDefault();
			enter(selected);
			return;
		}
		if (readonly) return;
		// Keyboard alternative to dragging (#26): Alt+Up/Down moves the selected block among its siblings.
		if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
			const action = event.key === 'ArrowUp' ? 'moveUp' : 'moveDown';
			if (blockTools(selected)?.some((t) => t.action === action && !t.disabled)) {
				event.preventDefault();
				channel?.send({ type: 'blockAction', blockKey: selected.ref.ownerKey, action });
			}
			return;
		}
	};

	/** The page's parts in reading order, leaving out ones that take no space (e.g. a title only in <head>). */
	function navigable(): CanvasTarget[] {
		const visible = index.targets.filter((t) => t.elements.some((el) => el.getClientRects().length > 0));
		// Overlay mode: what each part stands for, once each (Tab goes block to block, see represent()).
		const shown = openOnClick ? [...new Set(visible.map((t) => represent(t)!))] : visible;
		return shown.sort((a, b) => {
			const [x, y] = [a.elements[0], b.elements[0]];
			// A block and a property on the same element: the block first, it's around the property.
			if (x === y) return a.ref.kind === b.ref.kind ? 0 : a.ref.kind === 'Block' ? -1 : 1;
			return x.compareDocumentPosition(y) & 4 /* Node.DOCUMENT_POSITION_FOLLOWING */ ? -1 : 1;
		});
	}

	/** Keys typed in the page's own form fields are the page's. */
	const isPageField = (target: EventTarget | null) =>
		target instanceof (doc.defaultView ?? window).HTMLElement &&
		(target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

	/**
	 * Keyboard navigation (#35): Tab / Shift+Tab, and once something is selected the arrow keys, go to the next or
	 * previous part of the page in reading order. Tab starts from the top when the page itself has focus, and at either
	 * end is left alone, so focus can leave the page. Returns whether it handled the key.
	 */
	function navigate(event: KeyboardEvent): boolean {
		if (event.altKey || event.ctrlKey || event.metaKey || isPageField(event.target)) return false;
		const tab = event.key === 'Tab';
		const forward = tab ? !event.shiftKey : event.key === 'ArrowDown' || event.key === 'ArrowRight';
		const backward = tab ? event.shiftKey : event.key === 'ArrowUp' || event.key === 'ArrowLeft';
		if (!forward && !backward) return false;
		if (!selected && (!tab || (event.target !== doc.body && event.target !== doc.documentElement))) return false;

		const list = navigable();
		const at = selected ? list.indexOf(selected) : -1;
		const next = list[forward ? at + 1 : at < 0 ? list.length - 1 : at - 1];
		if (!next) {
			// The end of the page: Tab moves on (out of the page); arrows stay put.
			if (!tab) event.preventDefault();
			return !tab;
		}
		event.preventDefault();
		selectAndShow(next);
		return true;
	}

	function selectAndShow(target: CanvasTarget) {
		select(target);
		target.elements[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}

	/**
	 * Enter on the selection (#35): edits text in place; on a block, goes to the first thing inside it; otherwise (or
	 * read-only) asks the host to take focus to its editor in the side panel.
	 */
	function enter(target: CanvasTarget) {
		// Overlay mode: Enter does what a click does, straight to the editor (the keyboard way to open the overlay).
		if (openOnClick) {
			openEditor(target);
			return;
		}
		if (editsInPlace() && (requestInlineEdit(target) || richText.request(target))) return;
		if (target.ref.kind === 'Block') {
			const list = navigable();
			const inner = list[list.indexOf(target) + 1];
			if (inner && index.ancestorsOf(inner).includes(target)) {
				selectAndShow(inner);
				return;
			}
		}
		openEditor(target);
	}

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

		announce(BEFORE_RENDER_EVENT, url);
		patchDocument(doc, next, (node) => node === overlay.host);
		manifest = readManifest(doc)!;
		index = new TargetIndex(resolveMarkers(manifest, doc));
		// Targets are identified by what they point at, so the same things stay selected (unless they're gone).
		const selectedRef = selected?.ref ?? awaited;
		selected = null;
		const found = index.find(selectedRef);
		select(found, false);
		if (!found) awaited = selectedRef;
		// A lift stays (e.g. after a tool on the lifted block: duplicate, settings); the host already has it as the hover
		// (and as the selection, unless something else was selected since).
		lifted = index.find(lifted?.ref ?? null);
		hovered = lifted;
		overlay.setHover(lifted);
		overlay.setHighlight(index.find(highlighted));
		showErrors();
		refreshPlaceholders();
		// A reload of the frame (or the navigation guard) should come back to this render, not the first one.
		try {
			doc.defaultView?.history.replaceState(null, '', url + (doc.defaultView?.location.hash ?? ''));
		} catch {
			// Not a same-origin URL for this document (e.g. an about:srcdoc test page); nothing to remember.
		}

		announce(RENDERED_EVENT, url);
		sendReady();
		channel?.send({ type: 'rendered', url, ok: true });
		return true;
	}

	/** Tells the site's scripts about a re-render (docs/compatibility.md); a listener's error doesn't stop it. */
	function announce(type: string, url: string) {
		const win = doc.defaultView;
		if (win) doc.dispatchEvent(new win.CustomEvent(type, { detail: { url } }));
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
			if (value === readonly) return;
			readonly = value;
			if (readonly) inline.cancel();
			refreshPlaceholders();
			// Redraw the selection: its tools and handles depend on it.
			overlay.setSelection(selected, selected ? index.ancestorsOf(selected) : []);
		},
		setShowEmpty(value) {
			if (value === showEmpty) return;
			showEmpty = value;
			refreshPlaceholders();
		},
		setOpenOnClick(value) {
			if (value === openOnClick) return;
			openOnClick = value;
			// Lifting is an overlay mode thing (its toolbar's button).
			if (!openOnClick) lifted = null;
			// Nothing is edited on the page in overlay mode.
			if (openOnClick) inline.cancel();
			// Blank blocks say how their content is edited.
			refreshPlaceholders();
			// Redraw the selection: where its toolbar sits depends on it.
			overlay.setSelection(selected, selected ? index.ancestorsOf(selected) : []);
		},
		setHighlight(ref) {
			highlighted = ref;
			overlay.setHighlight(index.find(ref));
		},
		setStrings(next) {
			const known = Object.fromEntries(Object.entries(next).filter(([key]) => key in DEFAULT_CANVAS_STRINGS));
			strings = { ...DEFAULT_CANVAS_STRINGS, ...known };
			refreshPlaceholders();
			overlay.setSelection(selected, selected ? index.ancestorsOf(selected) : []);
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
		case 'setShowEmpty':
			runtime.setShowEmpty(message.show);
			break;
		case 'setOpenOnClick':
			runtime.setOpenOnClick(message.open);
			break;
		case 'setStrings':
			runtime.setStrings(message.strings);
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
