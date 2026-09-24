/**
 * Where a dragged Block List block would land (#26): the gap nearest the pointer in the innermost Block List under it.
 * Block Lists are known from the blocks' placements (#24): blocks sharing an owner and property are one list, ordered
 * by index. Geometry only; the runtime drives the drag and the overlay draws the indicator. Block Grid is grid.ts.
 */
import type { BlockPosition } from '../protocol/index.js';
import { unionRect } from './overlay.js';
import type { CanvasTarget } from './targets.js';

export const BLOCK_LIST = 'Umbraco.BlockList';

/** A Block List on the page: its owner and property, and its rendered blocks in order. */
export interface BlockListOnPage {
	ownerKey: string;
	propertyAlias: string;
	blocks: CanvasTarget[];
}

/** An indicator line (viewport coordinates): horizontal between list blocks, vertical beside grid blocks. */
export interface DropLine {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** A place to drop: the position to send the host, where to draw the indicator, and the container's size. */
export interface DropSpot {
	to: BlockPosition;
	line: DropLine;
	/** The container's area (px²): with lists and grids both under the pointer, the smaller one is the inner one. */
	area: number;
}

/** The Block Lists on the page, from the placed blocks among `targets`. */
export function blockListsOf(targets: readonly CanvasTarget[]): BlockListOnPage[] {
	const lists = new Map<string, BlockListOnPage>();
	for (const target of targets) {
		const block = target.block;
		if (target.ref.kind !== 'Block' || block?.editorAlias !== BLOCK_LIST || !target.elements.length) continue;
		const id = `${block.ownerKey}/${block.propertyAlias}/${block.propertyCulture ?? ''}`;
		let list = lists.get(id);
		if (!list) lists.set(id, (list = { ownerKey: block.ownerKey, propertyAlias: block.propertyAlias, blocks: [] }));
		list.blocks.push(target);
	}
	for (const list of lists.values()) list.blocks.sort((a, b) => a.block!.index - b.block!.index);
	return [...lists.values()];
}

/** Whether a container owned by `ownerKey` is inside `dragged` (it is the block, or a block within it). */
export function isInside(ownerKey: string, dragged: CanvasTarget, targets: readonly CanvasTarget[]): boolean {
	const key = dragged.ref.ownerKey;
	if (ownerKey === key) return true;
	const owner = targets.find((t) => t.ref.kind === 'Block' && t.ref.ownerKey === ownerKey);
	return !!owner?.block?.path.includes(key);
}

/** Gap between blocks: the indicator sits in the middle of it (or just outside the first/last block). */
const GAP = 4;
/** Indicator thickness. */
export const LINE = 3;

/**
 * The drop spot for a pointer at (x, y) in viewport coordinates: in the innermost list whose blocks' box contains
 * the pointer, before the first block whose middle is below it. Null when there's nowhere to drop, or dropping would
 * leave the block where it is.
 */
export function dropSpotAt(
	x: number,
	y: number,
	dragged: CanvasTarget,
	lists: readonly BlockListOnPage[],
	targets: readonly CanvasTarget[],
): DropSpot | null {
	let best: { list: BlockListOnPage; area: number } | null = null;
	for (const list of lists) {
		const box = unionRect(list.blocks.flatMap((b) => b.elements));
		if (!box || x < box.left || x > box.right || y < box.top - 24 || y > box.bottom + 24) continue;
		if (isInside(list.ownerKey, dragged, targets)) continue;
		const area = box.width * box.height;
		if (!best || area < best.area) best = { list, area };
	}
	if (!best) return null;

	const { list, area } = best;
	const rects = list.blocks.map((b) => unionRect(b.elements)!);
	let at = rects.findIndex((r) => y < r.top + r.height / 2);
	if (at < 0) at = rects.length;
	const index =
		at < list.blocks.length ? list.blocks[at].block!.index : list.blocks[list.blocks.length - 1].block!.index + 1;

	// Dropping right before or after itself leaves it where it is.
	const own = list.blocks.findIndex((b) => b.ref.ownerKey === dragged.ref.ownerKey);
	if (own >= 0 && (at === own || at === own + 1)) return null;

	const ref = rects[Math.min(at, rects.length - 1)];
	const top =
		at === 0 ? rects[0].top - GAP : at === rects.length ? ref.bottom + GAP : (rects[at - 1].bottom + rects[at].top) / 2;
	return {
		to: { ownerKey: list.ownerKey, propertyAlias: list.propertyAlias, areaKey: null, index },
		line: { left: ref.left, top: top - LINE / 2, width: ref.width, height: LINE },
		area,
	};
}
