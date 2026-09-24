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

	#box(target: CanvasTarget, kind: 'hover' | 'selected' | 'highlight', ancestors: CanvasTarget[] = []) {
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
		if (kind === 'highlight') return box;

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
