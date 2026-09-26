/**
 * Block Grid on the canvas (#27): its containers (the grid's root and every area, including empty ones), where a
 * dragged grid block would land, and column spans for resizing. Uses the markup of Umbraco's default Block Grid
 * partials:
 *
 * - `.umb-block-grid[data-grid-columns]` > `.umb-block-grid__layout-container` > `.umb-block-grid__layout-item`
 * - areas: `.umb-block-grid__area[data-area-alias]` (inside their block's layout item), each with its own layout
 *   container; its column count is the `--umb-block-grid--grid-columns` custom property.
 *
 * Areas are identified by alias on the page; the host finds the area's key from the block type's configuration.
 */
import type { BlockPosition } from '../protocol/index.js';
import { isInside, LINE, type DropLine, type DropSpot } from './drag.js';
import { unionRect } from './overlay.js';
import type { CanvasTarget } from './targets.js';

export const BLOCK_GRID = 'Umbraco.BlockGrid';

/** The grid's root, or an area of a grid block: where grid blocks can go. */
export interface GridContainer {
	/** The grid property: whose, and which. */
	ownerKey: string;
	propertyAlias: string;
	/** The block whose area this is, and the area's alias; null for the grid's root. */
	areaOwnerKey: string | null;
	areaAlias: string | null;
	/** The area's key when its blocks say so (areas with blocks); null for an empty area, or the root. */
	areaKey: string | null;
	/** The element the container's blocks are laid out in (for an empty area, the area itself). */
	element: Element;
	columns: number;
	/** Its blocks, in order. */
	blocks: CanvasTarget[];
}

const isGridBlock = (target: CanvasTarget) =>
	target.ref.kind === 'Block' && target.block?.editorAlias === BLOCK_GRID && target.elements.length > 0;

/** The column count a grid container lays its blocks out on. */
export function columnsOf(element: Element, fallback = 12): number {
	const win = element.ownerDocument.defaultView;
	const fromStyle = win
		? parseInt(win.getComputedStyle(element).getPropertyValue('--umb-block-grid--grid-columns'), 10)
		: NaN;
	if (fromStyle > 0) return fromStyle;
	const grid = element.closest('[data-grid-columns]');
	const fromGrid = grid ? parseInt(grid.getAttribute('data-grid-columns') ?? '', 10) : NaN;
	return fromGrid > 0 ? fromGrid : fallback;
}

/** The grid containers on the page, from the placed grid blocks among `targets`. */
export function gridContainersOf(targets: readonly CanvasTarget[]): GridContainer[] {
	const blocks = targets.filter(isGridBlock);
	const containers: GridContainer[] = [];

	// Roots: blocks at the root of a grid property.
	const roots = new Map<string, CanvasTarget[]>();
	for (const target of blocks) {
		const b = target.block!;
		if (b.areaOwnerKey) continue;
		const id = `${b.ownerKey}/${b.propertyAlias}/${b.propertyCulture ?? ''}`;
		roots.set(id, [...(roots.get(id) ?? []), target]);
	}
	for (const list of roots.values()) {
		const first = list[0];
		const element = first.elements[0].parentElement;
		if (!element) continue;
		containers.push({
			ownerKey: first.block!.ownerKey,
			propertyAlias: first.block!.propertyAlias,
			areaOwnerKey: null,
			areaAlias: null,
			areaKey: null,
			element,
			columns: columnsOf(element),
			blocks: list.sort((a, b) => a.block!.index - b.block!.index),
		});
	}

	// Areas: inside each grid block's own layout item (not its nested blocks' areas).
	for (const owner of blocks) {
		const item = owner.elements[0];
		for (const area of item.querySelectorAll('.umb-block-grid__area[data-area-alias]')) {
			if (area.closest('.umb-block-grid__layout-item') !== item) continue;
			const inside = blocks
				.filter((t) => t.block!.areaOwnerKey === owner.ref.ownerKey && area.contains(t.elements[0]))
				.sort((a, b) => a.block!.index - b.block!.index);
			const element = area.querySelector(':scope > .umb-block-grid__layout-container') ?? area;
			containers.push({
				ownerKey: owner.block!.ownerKey,
				propertyAlias: owner.block!.propertyAlias,
				areaOwnerKey: owner.ref.ownerKey,
				areaAlias: area.getAttribute('data-area-alias'),
				areaKey: inside[0]?.block!.areaKey ?? null,
				element,
				columns: columnsOf(area),
				blocks: inside,
			});
		}
	}
	return containers;
}

/**
 * Where a dragged grid block would land for a pointer at (x, y): in the innermost container under the pointer, before
 * the first block that comes after the pointer in reading order (above it, or on its row and past its middle). Null
 * when there's nowhere, or the block would stay where it is.
 */
export function gridDropSpotAt(
	x: number,
	y: number,
	dragged: CanvasTarget,
	containers: readonly GridContainer[],
	targets: readonly CanvasTarget[],
): DropSpot | null {
	let best: { container: GridContainer; box: DOMRect; area: number } | null = null;
	for (const container of containers) {
		const box = container.element.getBoundingClientRect();
		if (!box.width || x < box.left || x > box.right || y < box.top - 8 || y > box.bottom + 8) continue;
		if (container.areaOwnerKey && isInside(container.areaOwnerKey, dragged, targets)) continue;
		const area = box.width * Math.max(box.height, 1);
		if (!best || area < best.area) best = { container, box, area };
	}
	if (!best) return null;
	const { container, box, area } = best;

	const rects = container.blocks.map((b) => unionRect(b.elements)!);
	let at = rects.findIndex((r) => y < r.top || (y <= r.bottom && x < r.left + r.width / 2));
	if (at < 0) at = rects.length;

	const own = container.blocks.findIndex((b) => b.ref.ownerKey === dragged.ref.ownerKey);
	if (own >= 0 && (at === own || at === own + 1)) return null;

	const index = !rects.length
		? 0
		: at < rects.length
			? container.blocks[at].block!.index
			: container.blocks[rects.length - 1].block!.index + 1;

	let line: DropLine;
	if (!rects.length) {
		line = { left: box.left, top: box.top, width: box.width, height: LINE };
	} else if (at < rects.length) {
		const r = rects[at];
		line = { left: r.left - LINE - 1, top: r.top, width: LINE, height: r.height };
	} else {
		const r = rects[rects.length - 1];
		line = { left: r.right + 1, top: r.top, width: LINE, height: r.height };
	}

	const to: BlockPosition = {
		ownerKey: container.ownerKey,
		propertyAlias: container.propertyAlias,
		areaKey: container.areaKey,
		index,
		areaOwnerKey: container.areaOwnerKey,
		areaAlias: container.areaAlias,
	};
	return { to, line, area };
}

/** The container a grid block is laid out in. */
export function containerOf(target: CanvasTarget, containers: readonly GridContainer[]): GridContainer | null {
	return containers.find((c) => c.blocks.includes(target)) ?? null;
}

/**
 * The column span for a grid block resized so its right edge is at `x`: whole columns of its container, from its
 * left edge, between 1 and the container's column count.
 */
export function spanAt(x: number, block: DOMRect, container: GridContainer): number {
	const width = container.element.getBoundingClientRect().width;
	const column = width / container.columns;
	return Math.min(container.columns, Math.max(1, Math.round((x - block.left) / column)));
}
