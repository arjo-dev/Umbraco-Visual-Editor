/**
 * Hover, highlight and selection outlines drawn over the page (#17). The overlay is its own element in the top
 * layer (popover), with a shadow root: site CSS can't restyle it, our CSS can't leak into the site, and no site
 * z-index can cover it. Boxes follow their elements through scrolling, resizing and DOM changes.
 */
import type { BlockAction } from '../protocol/index.js';
import { targetLabel, type CanvasTarget } from './targets.js';

/** A button of the block toolbar shown on a selected block (#25). */
export interface BlockTool {
	action: BlockAction;
	label: string;
	disabled?: boolean;
}

export interface OverlayOptions {
	/** A breadcrumb entry (a parent block of the selection) was clicked. */
	onBreadcrumb?: (target: CanvasTarget) => void;
	/** The block toolbar's buttons for a selected block; none (or null) for no toolbar. */
	blockTools?: (target: CanvasTarget) => BlockTool[] | null;
	/** A block toolbar button was pressed. */
	onBlockTool?: (target: CanvasTarget, action: BlockAction) => void;
	/** Whether a hovered or selected block gets a drag handle (#26). */
	draggable?: (target: CanvasTarget) => boolean;
	/** A drag handle was pressed. */
	onDragStart?: (target: CanvasTarget, event: PointerEvent) => void;
	/** Whether a selected block gets a resize handle on its right edge (Block Grid column span, #27). */
	resizable?: (target: CanvasTarget) => boolean;
	/** A resize handle was pressed. */
	onResizeStart?: (target: CanvasTarget, event: PointerEvent) => void;
	/** Whether a hovered or selected block gets "+" buttons to add a block before and after it (#28). */
	insertable?: (target: CanvasTarget) => boolean;
	/** A "+" button was pressed: add a block before or after `target`. */
	onInsert?: (target: CanvasTarget, where: 'before' | 'after') => void;
}

/**
 * An empty place on the page, drawn as a dashed box: an empty grid area blocks can be added to (with a "+" button,
 * #28), or a block with nothing to show yet (a note only; clicks go through to the block).
 */
export interface Placeholder {
	element: Element;
	label: string;
	onInsert?: () => void;
}

/** What a resize would give (#27): the block's new box, and a label such as "6 / 12". */
export interface ResizePreview {
	left: number;
	top: number;
	width: number;
	height: number;
	label: string;
}

const BLOCK_COLOR = '#f79c37';
const PROPERTY_COLOR = '#3544b1';
const ERROR_COLOR = '#d42054';

export class CanvasOverlay {
	readonly host: HTMLElement;
	#root: ShadowRoot;
	#doc: Document;
	#options: OverlayOptions;
	#hover: CanvasTarget | null = null;
	#highlight: CanvasTarget | null = null;
	#selection: { target: CanvasTarget; ancestors: CanvasTarget[] } | null = null;
	#errors: Array<{ target: CanvasTarget; message: string }> = [];
	#dragging: CanvasTarget | null = null;
	#dropLine: { left: number; top: number; width: number; height: number } | null = null;
	#resizePreview: ResizePreview | null = null;
	#placeholders: Placeholder[] = [];
	#frame = 0;
	#resizeObserver: ResizeObserver;
	#mutationObserver: MutationObserver;
	#onViewportChange = () => this.#schedule();

	constructor(doc: Document = document, options: OverlayOptions = {}) {
		this.#doc = doc;
		this.#options = options;

		this.host = doc.createElement('uve-overlay');
		// Inline styles beat the site's (non-!important) rules; the popover UA styles are reset too.
		this.host.setAttribute(
			'style',
			'position:fixed;inset:0;width:100vw;height:100vh;margin:0;padding:0;border:0;background:transparent;' +
				'overflow:visible;pointer-events:none;z-index:2147483647;display:block;',
		);
		this.#root = this.host.attachShadow({ mode: 'open' });
		this.#root.innerHTML = `<style>${STYLES}</style><div class="layer" part="layer"></div>`;
		doc.body.append(this.host);
		if ('showPopover' in this.host) {
			this.host.setAttribute('popover', 'manual');
			(this.host as HTMLElement & { showPopover(): void }).showPopover();
		}

		const win = doc.defaultView ?? window;
		win.addEventListener('scroll', this.#onViewportChange, { capture: true, passive: true });
		win.addEventListener('resize', this.#onViewportChange, { passive: true });
		this.#resizeObserver = new ResizeObserver(this.#onViewportChange);
		this.#resizeObserver.observe(doc.documentElement);
		this.#mutationObserver = new MutationObserver((records) => {
			// Our own host changing isn't a page layout change.
			if (records.every((r) => r.target === this.host)) return;
			this.#schedule();
		});
		this.#mutationObserver.observe(doc.body, { subtree: true, childList: true, attributes: true, characterData: true });
	}

	setHover(target: CanvasTarget | null) {
		if (target === this.#hover) return;
		this.#hover = target;
		this.#render();
	}

	setHighlight(target: CanvasTarget | null) {
		this.#highlight = target;
		this.#render();
	}

	/** The block being dragged (#26): shown dimmed, without hover or handles meanwhile. */
	setDragging(target: CanvasTarget | null) {
		this.#dragging = target;
		this.#render();
	}

	/** Where the dragged block would drop: a line between or beside blocks (viewport coordinates), or none. */
	setDropLine(line: { left: number; top: number; width: number; height: number } | null) {
		this.#dropLine = line;
		this.#render();
	}

	/** Empty places to add blocks to (#28). */
	setPlaceholders(placeholders: Placeholder[]) {
		this.#placeholders = placeholders;
		this.#render();
	}

	/** A block being resized (#27): its new size, drawn over it. */
	setResizePreview(preview: ResizePreview | null) {
		this.#resizePreview = preview;
		this.#render();
	}

	/** Validation errors (#23): outlined, with a badge, always visible. */
	setErrors(errors: Array<{ target: CanvasTarget; message: string }>) {
		this.#errors = errors;
		this.#render();
	}

	/** Something is being edited in place with a toolbar above it (#57): the selection's label would sit under it. */
	setEditing(editing: boolean) {
		this.#root.querySelector('.layer')!.classList.toggle('editing', editing);
	}

	setSelection(target: CanvasTarget | null, ancestors: CanvasTarget[] = []) {
		this.#selection = target ? { target, ancestors } : null;
		this.#observeTargets();
		this.#render();
	}

	destroy() {
		const win = this.#doc.defaultView ?? window;
		win.removeEventListener('scroll', this.#onViewportChange, { capture: true });
		win.removeEventListener('resize', this.#onViewportChange);
		this.#resizeObserver.disconnect();
		this.#mutationObserver.disconnect();
		cancelAnimationFrame(this.#frame);
		this.host.remove();
	}

	#observeTargets() {
		this.#resizeObserver.disconnect();
		this.#resizeObserver.observe(this.#doc.documentElement);
		for (const el of this.#selection?.target.elements ?? []) this.#resizeObserver.observe(el);
	}

	#schedule() {
		if (this.#frame) return;
		this.#frame = requestAnimationFrame(() => {
			this.#frame = 0;
			this.#render();
		});
	}

	#render() {
		const layer = this.#root.querySelector('.layer')!;
		layer.replaceChildren();

		for (const { target, message } of this.#errors) layer.append(this.#errorBox(target, message));
		for (const placeholder of this.#placeholders) layer.append(this.#placeholder(placeholder));

		if (this.#resizePreview) {
			const { left, top, width, height, label } = this.#resizePreview;
			const box = this.#doc.createElement('div');
			box.className = 'resizing';
			Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
			const tag = this.#doc.createElement('span');
			tag.className = 'label';
			tag.textContent = label;
			box.append(tag);
			layer.append(box);
			return;
		}

		if (this.#dragging) {
			const box = this.#box(this.#dragging, 'dragging');
			layer.append(box);
			if (this.#dropLine) {
				const line = this.#doc.createElement('div');
				line.className = 'drop';
				Object.assign(line.style, {
					left: `${this.#dropLine.left}px`,
					top: `${this.#dropLine.top}px`,
					width: `${this.#dropLine.width}px`,
					height: `${this.#dropLine.height}px`,
				});
				layer.append(line);
			}
			return;
		}

		if (this.#highlight) layer.append(this.#box(this.#highlight, 'highlight'));
		if (this.#hover && this.#hover !== this.#selection?.target) layer.append(this.#box(this.#hover, 'hover'));
		if (this.#selection) layer.append(this.#box(this.#selection.target, 'selected', this.#selection.ancestors));
	}

	#errorBox(target: CanvasTarget, message: string) {
		const rect = unionRect(target.elements);
		const box = this.#doc.createElement('div');
		box.className = `box error ${target.ref.kind === 'Block' ? 'block' : 'property'}`;
		if (!rect) {
			box.hidden = true;
			return box;
		}
		Object.assign(box.style, {
			left: `${rect.left}px`,
			top: `${rect.top}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
		});
		const badge = this.#doc.createElement('span');
		badge.className = 'badge';
		badge.textContent = '!';
		badge.title = message;
		box.append(badge);
		return box;
	}

	/** A "+" on the block's top edge (add before) or bottom edge (add after). */
	#adder(target: CanvasTarget, where: 'before' | 'after') {
		const button = this.#doc.createElement('button');
		button.type = 'button';
		button.className = `add ${where}`;
		button.title = where === 'before' ? 'Add a block before this one' : 'Add a block after this one';
		button.setAttribute('aria-label', button.title);
		button.textContent = '+';
		button.addEventListener('pointerdown', (event) => event.stopPropagation());
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.#options.onInsert?.(target, where);
		});
		return button;
	}

	/** An empty place to add blocks to: a dashed box over it, with a "+" button. */
	#placeholder({ element, label, onInsert }: Placeholder) {
		const box = this.#doc.createElement('div');
		box.className = `placeholder${onInsert ? '' : ' note'}`;
		const rect = element.getBoundingClientRect();
		if (!rect.width) {
			box.hidden = true;
			return box;
		}
		Object.assign(box.style, {
			left: `${rect.left}px`,
			top: `${rect.top}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
		});
		if (!onInsert) {
			const note = this.#doc.createElement('span');
			note.className = 'placeholder-note';
			note.textContent = label;
			box.append(note);
			return box;
		}
		const button = this.#doc.createElement('button');
		button.type = 'button';
		button.className = 'placeholder-add';
		button.textContent = `+ ${label}`;
		button.addEventListener('pointerdown', (event) => event.stopPropagation());
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			onInsert();
		});
		box.append(button);
		return box;
	}

	/** The resize handle: the block's right edge, dragged sideways to change its column span. */
	#resizer(target: CanvasTarget) {
		const handle = this.#doc.createElement('button');
		handle.type = 'button';
		handle.className = 'resize';
		handle.title = `Drag to change the width of ${targetLabel(target.ref)}`;
		handle.setAttribute('aria-label', handle.title);
		handle.addEventListener('pointerdown', (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			this.#options.onResizeStart?.(target, event);
		});
		handle.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		return handle;
	}

	/** The drag handle, at the block's left edge (inside it when there's no room outside). */
	#grip(target: CanvasTarget, inside: boolean) {
		const grip = this.#doc.createElement('button');
		grip.type = 'button';
		grip.className = `grip${inside ? ' inside' : ''}`;
		grip.title = `Drag to move ${targetLabel(target.ref)}`;
		grip.setAttribute('aria-label', grip.title);
		grip.innerHTML = GRIP_ICON;
		grip.addEventListener('pointerdown', (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			this.#options.onDragStart?.(target, event);
		});
		// Clicks on the handle aren't clicks on the page.
		grip.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		return grip;
	}

	#toolbar(target: CanvasTarget, tools: BlockTool[], inside: boolean) {
		const bar = this.#doc.createElement('div');
		bar.className = `tools${inside ? ' inside' : ''}`;
		bar.setAttribute('role', 'toolbar');
		bar.setAttribute('aria-label', `${targetLabel(target.ref)} actions`);
		for (const tool of tools) {
			const button = this.#doc.createElement('button');
			button.type = 'button';
			button.className = `tool ${tool.action}`;
			button.title = tool.label;
			button.setAttribute('aria-label', tool.label);
			button.disabled = !!tool.disabled;
			button.innerHTML = ICONS[tool.action];
			button.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.#options.onBlockTool?.(target, tool.action);
			});
			bar.append(button);
		}
		return bar;
	}

	#box(target: CanvasTarget, kind: 'hover' | 'selected' | 'highlight' | 'dragging', ancestors: CanvasTarget[] = []) {
		const rect = unionRect(target.elements);
		const box = this.#doc.createElement('div');
		box.className = `box ${kind} ${target.ref.kind === 'Block' ? 'block' : 'property'}`;
		if (!rect) {
			box.hidden = true;
			return box;
		}
		Object.assign(box.style, {
			left: `${rect.left}px`,
			top: `${rect.top}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
		});
		if (kind === 'highlight' || kind === 'dragging') return box;

		if (this.#options.draggable?.(target)) box.append(this.#grip(target, rect.left < 24));
		if (kind === 'selected' && this.#options.resizable?.(target)) box.append(this.#resizer(target));
		if ((kind === 'hover' || kind === 'selected') && this.#options.insertable?.(target)) {
			box.append(this.#adder(target, 'before'), this.#adder(target, 'after'));
		}

		const label = this.#doc.createElement('div');
		label.className = `label${rect.top < 24 ? ' inside' : ''}`;
		if (kind === 'selected') {
			// Outermost block first, down to the selection: "Two Column › Image Row › Caption".
			for (const ancestor of [...ancestors].reverse()) {
				const crumb = this.#doc.createElement('button');
				crumb.type = 'button';
				crumb.className = 'crumb';
				crumb.textContent = targetLabel(ancestor.ref);
				crumb.title = `Select ${targetLabel(ancestor.ref)}`;
				crumb.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					this.#options.onBreadcrumb?.(ancestor);
				});
				label.append(crumb, this.#doc.createTextNode(' › '));
			}
		}
		if (kind === 'selected' && target.ref.kind === 'Block') {
			const tools = this.#options.blockTools?.(target);
			if (tools?.length) box.append(this.#toolbar(target, tools, rect.top < 24));
		}

		const name = this.#doc.createElement('span');
		name.textContent =
			kind === 'hover' && target.ref.ownerLabel
				? `${targetLabel(target.ref)} · ${target.ref.ownerLabel}`
				: targetLabel(target.ref);
		label.append(name);
		box.append(label);
		return box;
	}
}

/** Bounding box of all of a target's visible elements, in viewport coordinates. */
export function unionRect(elements: Element[]): DOMRect | null {
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const el of elements) {
		const r = el.getBoundingClientRect();
		if (r.width === 0 && r.height === 0) continue;
		left = Math.min(left, r.left);
		top = Math.min(top, r.top);
		right = Math.max(right, r.right);
		bottom = Math.max(bottom, r.bottom);
	}
	return left === Infinity ? null : new DOMRect(left, top, right - left, bottom - top);
}

const svg = (path: string) => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${path}"/></svg>`;
const ICONS: Record<BlockAction, string> = {
	moveUp: svg('M8 2.5 13.5 8l-1.4 1.4L9 6.3V14H7V6.3L3.9 9.4 2.5 8z'),
	moveDown: svg('M8 13.5 2.5 8l1.4-1.4L7 9.7V2h2v7.7l3.1-3.1L13.5 8z'),
	duplicate: svg(
		'M5 1h8a2 2 0 0 1 2 2v8h-2V3H5zM1 5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2zm2 0v8h7V5z',
	),
	delete: svg('M6 1h4l1 1h3v2H2V2h3zM3 5h10l-1 10H4zm3 2v6h1V7zm3 0v6h1V7z'),
	settings: svg(
		'M2 3h7v2H2zm9 0h3v2h-3zm-2-1h2v4H9zM2 7h3v2H2zm5 0h7v2H7zM5 6h2v4H5zm-3 5h7v2H2zm9 0h3v2h-3zm-2-1h2v4H9z',
	),
};

const GRIP_ICON =
	'<svg viewBox="0 0 12 16" aria-hidden="true"><circle cx="3.5" cy="3" r="1.5"/><circle cx="8.5" cy="3" r="1.5"/><circle cx="3.5" cy="8" r="1.5"/><circle cx="8.5" cy="8" r="1.5"/><circle cx="3.5" cy="13" r="1.5"/><circle cx="8.5" cy="13" r="1.5"/></svg>';

const STYLES = `
	:host { all: initial; }
	.layer { position: fixed; inset: 0; pointer-events: none; font: 12px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; }
	.box { position: fixed; box-sizing: border-box; border-radius: 2px; }
	.box.hover.property { outline: 1px dashed ${PROPERTY_COLOR}; outline-offset: 2px; }
	.box.hover.block { outline: 1px dashed ${BLOCK_COLOR}; outline-offset: 3px; }
	.box.selected.property { outline: 2px solid ${PROPERTY_COLOR}; outline-offset: 2px; }
	.box.selected.block { outline: 2px solid ${BLOCK_COLOR}; outline-offset: 3px; }
	.box.error.property { outline: 2px solid ${ERROR_COLOR}; outline-offset: 2px; }
	.box.error.block { outline: 1px dashed ${ERROR_COLOR}; outline-offset: 3px; }
	.box.error .badge {
		position: absolute; top: -10px; right: -10px; width: 18px; height: 18px; border-radius: 50%;
		display: grid; place-items: center; font-weight: 700; color: #fff; background: ${ERROR_COLOR};
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
	}
	.box.error.block .badge { top: -11px; right: -11px; }
	.box.highlight { background: color-mix(in srgb, ${PROPERTY_COLOR} 12%, transparent); outline: 1px solid ${PROPERTY_COLOR}; }
	.label {
		position: absolute; left: -2px; bottom: calc(100% + 4px); white-space: nowrap;
		padding: 2px 6px; border-radius: 3px; color: #fff; background: ${PROPERTY_COLOR};
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
	}
	.block > .label { background: ${BLOCK_COLOR}; color: #1b264f; }
	.label.inside { bottom: auto; top: 4px; left: 4px; }
	.add {
		all: unset; position: absolute; left: 50%; width: 20px; height: 20px; margin-left: -10px; border-radius: 50%;
		display: grid; place-items: center; font: 700 15px/1 system-ui, sans-serif; cursor: pointer; pointer-events: auto;
		color: #fff; background: ${PROPERTY_COLOR}; box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
	}
	.add.before { top: -10px; }
	.add.after { bottom: -10px; }
	.add:hover, .add:focus-visible { transform: scale(1.12); }
	.placeholder {
		position: fixed; box-sizing: border-box; display: grid; place-items: center; border-radius: 3px;
		outline: 1px dashed ${PROPERTY_COLOR}; outline-offset: -1px; background: color-mix(in srgb, ${PROPERTY_COLOR} 6%, transparent);
	}
	.placeholder-add {
		all: unset; padding: 4px 10px; border-radius: 3px; cursor: pointer; pointer-events: auto; color: #fff;
		background: ${PROPERTY_COLOR}; font-weight: 600;
	}
	.placeholder-add:hover, .placeholder-add:focus-visible { filter: brightness(1.15); }
	.placeholder.note { outline-color: ${BLOCK_COLOR}; background: color-mix(in srgb, ${BLOCK_COLOR} 8%, transparent); }
	.placeholder-note { padding: 4px 10px; color: #6b4b12; font-style: italic; }
	.box.dragging { background: color-mix(in srgb, ${BLOCK_COLOR} 18%, transparent); outline: 2px dashed ${BLOCK_COLOR}; outline-offset: 3px; }
	.drop { position: fixed; border-radius: 2px; background: ${BLOCK_COLOR}; box-shadow: 0 0 0 1px #fff; }
	.resize {
		all: unset; position: absolute; right: -8px; top: 50%; transform: translateY(-50%); width: 8px; height: 36px;
		border-radius: 3px; cursor: col-resize; pointer-events: auto; background: ${BLOCK_COLOR};
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
	}
	.resize::after { content: ''; position: absolute; inset: 8px 3px; border-left: 1px solid #1b264f; border-right: 1px solid #1b264f; }
	.resizing {
		position: fixed; box-sizing: border-box; outline: 2px dashed ${BLOCK_COLOR}; outline-offset: 3px;
		background: color-mix(in srgb, ${BLOCK_COLOR} 12%, transparent);
	}
	.resizing .label { background: ${BLOCK_COLOR}; color: #1b264f; }
	.grip {
		all: unset; position: absolute; left: -24px; top: 50%; transform: translateY(-50%); display: grid; place-items: center;
		width: 18px; height: 28px; border-radius: 3px; cursor: grab; pointer-events: auto; color: #1b264f;
		background: ${BLOCK_COLOR}; box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
	}
	.grip.inside { left: 4px; }
	.grip svg { width: 12px; height: 16px; fill: currentColor; }
	.grip:hover, .grip:focus-visible { filter: brightness(1.08); }
	.tools {
		position: absolute; right: -3px; bottom: calc(100% + 4px); display: flex; gap: 1px; padding: 1px;
		border-radius: 3px; background: ${BLOCK_COLOR}; box-shadow: 0 1px 3px rgb(0 0 0 / 0.25); pointer-events: auto;
	}
	.tools.inside { bottom: auto; top: 4px; right: 4px; }
	.tool {
		all: unset; display: grid; place-items: center; width: 22px; height: 20px; border-radius: 2px; cursor: pointer;
		color: #1b264f;
	}
	.tool svg { width: 14px; height: 14px; fill: currentColor; }
	.tool:hover:not(:disabled), .tool:focus-visible { background: rgb(255 255 255 / 0.45); }
	.tool:focus-visible { outline: 1px solid #1b264f; }
	.tool:disabled { opacity: 0.35; cursor: default; }
	.editing .box.selected .label { display: none; }
	.crumb {
		all: unset; cursor: pointer; pointer-events: auto; text-decoration: underline; text-underline-offset: 2px;
		opacity: 0.85;
	}
	.crumb:hover, .crumb:focus-visible { opacity: 1; outline: 1px solid currentColor; outline-offset: 1px; }
`;
