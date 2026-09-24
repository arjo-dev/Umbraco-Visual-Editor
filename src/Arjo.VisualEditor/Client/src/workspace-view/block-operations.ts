/**
 * Changes to a block editor value (#25): move a block among its siblings, delete it, duplicate it. Pure functions over
 * the value the backoffice edits:
 *
 * `{ layout: { [editorAlias]: items[] }, contentData: [...], settingsData: [...], expose: [...] }`
 *
 * Layout items are `{ contentKey, settingsKey }`; Block Grid items add `columnSpan`, `rowSpan` and
 * `areas: [{ key, items }]`. A block's own values can hold further block values (nested block editors, rich text
 * `{ markup, blocks }`), whose keys must be unique across the whole document too.
 */

type Obj = Record<string, unknown>;

export interface LayoutItem extends Obj {
	contentKey: string;
	settingsKey?: string | null;
	areas?: Array<{ key: string; items: LayoutItem[] } & Obj>;
}

export interface BlockEditorValue extends Obj {
	layout: Record<string, LayoutItem[]>;
	contentData: Array<{ key: string } & Obj>;
	settingsData?: Array<{ key: string } & Obj>;
	expose?: Array<{ contentKey: string } & Obj>;
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isBlockEditorValue(value: unknown): value is BlockEditorValue {
	return isObj(value) && isObj(value.layout) && Array.isArray(value.contentData);
}

/** The items array holding `contentKey` (a layout's root, or a grid area), with a setter for a changed copy. */
function findSiblings(
	value: BlockEditorValue,
	contentKey: string,
): { items: LayoutItem[]; index: number; replace: (items: LayoutItem[]) => BlockEditorValue } | null {
	const search = (
		items: LayoutItem[],
		rebuild: (items: LayoutItem[]) => BlockEditorValue,
	): ReturnType<typeof findSiblings> => {
		const index = items.findIndex((item) => item.contentKey === contentKey);
		if (index >= 0) return { items, index, replace: rebuild };
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			for (let a = 0; a < (item.areas?.length ?? 0); a++) {
				const area = item.areas![a];
				const found = search(area.items, (areaItems) => {
					const areas = [...item.areas!];
					areas[a] = { ...area, items: areaItems };
					const copy = [...items];
					copy[i] = { ...item, areas };
					return rebuild(copy);
				});
				if (found) return found;
			}
		}
		return null;
	};
	for (const [editorAlias, items] of Object.entries(value.layout)) {
		if (!Array.isArray(items)) continue;
		const found = search(items, (changed) => ({ ...value, layout: { ...value.layout, [editorAlias]: changed } }));
		if (found) return found;
	}
	return null;
}

/** Whether the block can move by `delta` among its siblings. */
export function canMoveBlock(value: BlockEditorValue, contentKey: string, delta: -1 | 1): boolean {
	const found = findSiblings(value, contentKey);
	if (!found) return false;
	const to = found.index + delta;
	return to >= 0 && to < found.items.length;
}

/** The value with the block moved one place up (-1) or down (+1) among its siblings; unchanged when it can't move. */
export function moveBlock(value: BlockEditorValue, contentKey: string, delta: -1 | 1): BlockEditorValue {
	const found = findSiblings(value, contentKey);
	if (!found) return value;
	const to = found.index + delta;
	if (to < 0 || to >= found.items.length) return value;
	const items = [...found.items];
	[items[found.index], items[to]] = [items[to], items[found.index]];
	return found.replace(items);
}

/** Content and settings keys of a layout item and every item in its grid areas. */
function layoutKeys(item: LayoutItem, keys = { content: new Set<string>(), settings: new Set<string>() }) {
	keys.content.add(item.contentKey);
	if (item.settingsKey) keys.settings.add(item.settingsKey);
	for (const area of item.areas ?? []) for (const child of area.items) layoutKeys(child, keys);
	return keys;
}

/** The value without the block: its layout item, its grid areas' blocks, and their content, settings and expose entries. */
export function removeBlock(value: BlockEditorValue, contentKey: string): BlockEditorValue {
	const found = findSiblings(value, contentKey);
	if (!found) return value;
	const { content, settings } = layoutKeys(found.items[found.index]);
	const next = found.replace(found.items.filter((_, i) => i !== found.index));
	return {
		...next,
		contentData: next.contentData.filter((d) => !content.has(d.key)),
		...(next.settingsData ? { settingsData: next.settingsData.filter((d) => !settings.has(d.key)) } : {}),
		...(next.expose ? { expose: next.expose.filter((e) => !content.has(e.contentKey)) } : {}),
	};
}

/**
 * A deep copy of `node` with every block key found in `keys` replaced, including keys inside nested block values and
 * rich text markup (`data-content-key="…"`).
 */
function rekey(node: unknown, keys: Map<string, string>): unknown {
	if (typeof node === 'string') {
		// Rich text markup refers to its blocks by content key, in data-content-key attributes.
		if (node.includes('data-content-key=')) {
			return node.replace(/data-content-key="([^"]*)"/g, (match, key: string) =>
				keys.has(key) ? `data-content-key="${keys.get(key)}"` : match,
			);
		}
		return keys.get(node) ?? node;
	}
	if (Array.isArray(node)) return node.map((item) => rekey(item, keys));
	if (!isObj(node)) return node;
	return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, rekey(v, keys)]));
}

/** Every block key inside `node`: layout, data and expose keys of nested block values (for new ones on duplicate). */
function nestedBlockKeys(node: unknown, keys: Set<string>) {
	if (Array.isArray(node)) {
		node.forEach((item) => nestedBlockKeys(item, keys));
		return;
	}
	if (!isObj(node)) return;
	if (isBlockEditorValue(node)) {
		for (const data of [...node.contentData, ...(node.settingsData ?? [])]) keys.add(data.key);
	}
	Object.values(node).forEach((child) => nestedBlockKeys(child, keys));
}

/**
 * The value with a copy of the block inserted right after it: new keys for the block, its settings, the blocks in its
 * grid areas and every block nested in their values. Returns the new block's content key too.
 */
export function duplicateBlock(
	value: BlockEditorValue,
	contentKey: string,
	newKey: () => string = () => crypto.randomUUID(),
): { value: BlockEditorValue; contentKey: string } | null {
	const found = findSiblings(value, contentKey);
	if (!found) return null;
	const item = found.items[found.index];
	const { content, settings } = layoutKeys(item);
	const contentData = value.contentData.filter((d) => content.has(d.key));
	const settingsData = (value.settingsData ?? []).filter((d) => settings.has(d.key));

	const keys = new Set<string>([...content, ...settings]);
	nestedBlockKeys([contentData, settingsData], keys);
	const renamed = new Map([...keys].map((key) => [key, newKey()]));

	const copy = rekey(item, renamed) as LayoutItem;
	const items = [...found.items];
	items.splice(found.index + 1, 0, copy);
	const next = found.replace(items);
	return {
		value: {
			...next,
			contentData: [...next.contentData, ...(rekey(contentData, renamed) as BlockEditorValue['contentData'])],
			...(next.settingsData || settingsData.length
				? {
						settingsData: [
							...(next.settingsData ?? []),
							...(rekey(settingsData, renamed) as NonNullable<BlockEditorValue['settingsData']>),
						],
					}
				: {}),
			...(next.expose
				? {
						expose: [
							...next.expose,
							...(rekey(
								next.expose.filter((e) => content.has(e.contentKey)),
								renamed,
							) as NonNullable<BlockEditorValue['expose']>),
						],
					}
				: {}),
		},
		contentKey: copy.contentKey,
	};
}

/** A block taken out of one block editor value, to be put into another (#26). */
export interface TakenBlock {
	item: LayoutItem;
	contentData: BlockEditorValue['contentData'];
	settingsData: NonNullable<BlockEditorValue['settingsData']>;
	expose: NonNullable<BlockEditorValue['expose']>;
}

/**
 * The value with the block moved to position `index` of its own list: `index` counts the gaps before the block is
 * taken out (0 = first, siblings.length = last), as a drop between two blocks does.
 */
export function moveBlockTo(value: BlockEditorValue, contentKey: string, index: number): BlockEditorValue {
	const found = findSiblings(value, contentKey);
	if (!found) return value;
	const to = index > found.index ? index - 1 : index;
	if (to === found.index || to < 0 || to >= found.items.length) return value;
	const items = found.items.filter((_, i) => i !== found.index);
	items.splice(to, 0, found.items[found.index]);
	return found.replace(items);
}

/** The value without the block, and the block with everything that goes with it (as removeBlock removes it). */
export function takeBlock(
	value: BlockEditorValue,
	contentKey: string,
): { value: BlockEditorValue; taken: TakenBlock } | null {
	const found = findSiblings(value, contentKey);
	if (!found) return null;
	const item = found.items[found.index];
	const { content, settings } = layoutKeys(item);
	return {
		value: removeBlock(value, contentKey),
		taken: {
			item,
			contentData: value.contentData.filter((d) => content.has(d.key)),
			settingsData: (value.settingsData ?? []).filter((d) => settings.has(d.key)),
			expose: (value.expose ?? []).filter((e) => content.has(e.contentKey)),
		},
	};
}

/** The value with a taken block put in its `editorAlias` layout at `index` (clamped to the list's length). */
export function putBlock(
	value: BlockEditorValue,
	editorAlias: string,
	taken: TakenBlock,
	index: number,
): BlockEditorValue {
	const items = [...(value.layout[editorAlias] ?? [])];
	items.splice(Math.max(0, Math.min(index, items.length)), 0, taken.item);
	return {
		...value,
		layout: { ...value.layout, [editorAlias]: items },
		contentData: [...value.contentData, ...taken.contentData],
		settingsData: [...(value.settingsData ?? []), ...taken.settingsData],
		expose: [...(value.expose ?? []), ...taken.expose],
	};
}

/** Where a block sits in its value: its layout (editor alias), the grid area it's in (if any) and its layout item. */
export interface LayoutPosition {
	editorAlias: string;
	areaOwnerKey: string | null;
	areaKey: string | null;
	item: LayoutItem;
}

export function layoutPosition(value: BlockEditorValue, contentKey: string): LayoutPosition | null {
	const search = (
		items: LayoutItem[],
		editorAlias: string,
		areaOwnerKey: string | null,
		areaKey: string | null,
	): LayoutPosition | null => {
		for (const item of items) {
			if (item.contentKey === contentKey) return { editorAlias, areaOwnerKey, areaKey, item };
			for (const area of item.areas ?? []) {
				const found = search(area.items, editorAlias, item.contentKey, area.key);
				if (found) return found;
			}
		}
		return null;
	};
	for (const [editorAlias, items] of Object.entries(value.layout)) {
		if (!Array.isArray(items)) continue;
		const found = search(items, editorAlias, null, null);
		if (found) return found;
	}
	return null;
}

/**
 * The value with a taken block put in grid area `areaKey` of block `areaOwnerKey`, at `index` (clamped). The area's
 * layout entry is added when the block's layout doesn't have it yet (an area that was never used).
 */
export function putBlockInArea(
	value: BlockEditorValue,
	areaOwnerKey: string,
	areaKey: string,
	taken: TakenBlock,
	index: number,
): BlockEditorValue {
	const insert = (items: LayoutItem[]): LayoutItem[] | null => {
		let changed = false;
		const next = items.map((item) => {
			if (changed) return item;
			if (item.contentKey === areaOwnerKey) {
				changed = true;
				const areas = [...(item.areas ?? [])];
				let at = areas.findIndex((a) => a.key === areaKey);
				if (at < 0) at = areas.push({ key: areaKey, items: [] }) - 1;
				const areaItems = [...areas[at].items];
				areaItems.splice(Math.max(0, Math.min(index, areaItems.length)), 0, taken.item);
				areas[at] = { ...areas[at], items: areaItems };
				return { ...item, areas };
			}
			for (let a = 0; a < (item.areas?.length ?? 0); a++) {
				const nested = insert(item.areas![a].items);
				if (nested) {
					changed = true;
					const areas = [...item.areas!];
					areas[a] = { ...areas[a], items: nested };
					return { ...item, areas };
				}
			}
			return item;
		});
		return changed ? next : null;
	};
	for (const [editorAlias, items] of Object.entries(value.layout)) {
		if (!Array.isArray(items)) continue;
		const next = insert(items);
		if (next) {
			return {
				...value,
				layout: { ...value.layout, [editorAlias]: next },
				contentData: [...value.contentData, ...taken.contentData],
				settingsData: [...(value.settingsData ?? []), ...taken.settingsData],
				expose: [...(value.expose ?? []), ...taken.expose],
			};
		}
	}
	return value;
}

/** The value with a grid block's column span set. */
export function withColumnSpan(value: BlockEditorValue, contentKey: string, columnSpan: number): BlockEditorValue {
	const found = findSiblings(value, contentKey);
	if (!found || found.items[found.index].columnSpan === columnSpan) return value;
	const items = [...found.items];
	items[found.index] = { ...items[found.index], columnSpan };
	return found.replace(items);
}

/**
 * A column span that fits a container `columns` wide: `wanted` when it's allowed and fits; otherwise the allowed
 * span nearest to it that fits. `allowed` empty means any span. Null when no allowed span fits.
 */
export function fitSpan(wanted: number, columns: number, allowed: readonly number[]): number | null {
	const options = (allowed.length ? [...allowed] : Array.from({ length: columns }, (_, i) => i + 1)).filter(
		(span) => span > 0 && span <= columns,
	);
	if (!options.length) return null;
	return options.reduce((best, span) =>
		Math.abs(span - wanted) < Math.abs(best - wanted) ||
		(Math.abs(span - wanted) === Math.abs(best - wanted) && span > best)
			? span
			: best,
	);
}

/** What a new block needs (#28): its type, its settings type (if its block type has settings) and, in a grid, its size. */
export interface NewBlockOptions {
	contentTypeKey: string;
	settingsTypeKey?: string | null;
	/** Block Grid: the column span, rows and the block type's areas (they start empty). */
	grid?: { columnSpan: number; rowSpan: number; areaKeys: string[] };
	/** The culture the block is exposed in: the edited culture when its element type varies by culture, else null. */
	exposeCulture: string | null;
	newKey?: () => string;
}

/** A new, empty block, ready to put in a value (putBlock / putBlockInArea). */
export function newBlock(options: NewBlockOptions): TakenBlock {
	const newKey = options.newKey ?? (() => crypto.randomUUID());
	const contentKey = newKey();
	const settingsKey = options.settingsTypeKey ? newKey() : null;
	const item: LayoutItem = { contentKey, settingsKey };
	if (options.grid) {
		item.columnSpan = options.grid.columnSpan;
		item.rowSpan = options.grid.rowSpan;
		item.areas = options.grid.areaKeys.map((key) => ({ key, items: [] }));
	}
	return {
		item,
		contentData: [{ key: contentKey, contentTypeKey: options.contentTypeKey, values: [] }],
		settingsData: settingsKey ? [{ key: settingsKey, contentTypeKey: options.settingsTypeKey!, values: [] }] : [],
		expose: [{ contentKey, culture: options.exposeCulture, segment: null }],
	};
}

/** A clipboard entry value, as the CMS clipboard stores it: `{ type, value }` (#29). */
export interface ClipboardValue {
	type: string;
	value: unknown;
}

/** The CMS clipboard's block value types: any block editor's `'block'`, and Block Grid's `'gridBlock'` (with areas). */
export const CLIPBOARD_BLOCK = 'block';
export const CLIPBOARD_GRID_BLOCK = 'gridBlock';

interface ClipboardBlockValue {
	contentData: BlockEditorValue['contentData'];
	settingsData?: BlockEditorValue['settingsData'];
	layout?: LayoutItem[];
}

const isClipboardBlockValue = (value: unknown): value is ClipboardBlockValue =>
	isObj(value) && Array.isArray(value.contentData) && (value.layout === undefined || Array.isArray(value.layout));

/**
 * A block (as taken from a value, with everything in it) as CMS clipboard entry values, the way the standard block
 * editors copy one: a `'block'` value with the block itself, and for grid blocks also a `'gridBlock'` value with its
 * areas and the blocks in them.
 */
export function toClipboardValues(block: TakenBlock, grid: boolean): ClipboardValue[] {
	const { item } = block;
	const values: ClipboardValue[] = [
		{
			type: CLIPBOARD_BLOCK,
			value: {
				contentData: block.contentData.filter((d) => d.key === item.contentKey),
				settingsData: block.settingsData.filter((d) => d.key === item.settingsKey),
				layout: [{ contentKey: item.contentKey, settingsKey: item.settingsKey ?? null }],
			},
		},
	];
	if (grid) {
		values.push({
			type: CLIPBOARD_GRID_BLOCK,
			value: { contentData: block.contentData, settingsData: block.settingsData, layout: [item] },
		});
	}
	return values;
}

/**
 * The blocks of a CMS clipboard entry, ready to put into a Block List (`grid` false) or Block Grid: with new keys
 * throughout (the entry may be pasted many times, and next to the blocks it was copied from). A grid takes a
 * `'gridBlock'` value as it is (areas, spans); otherwise a `'block'` value's blocks come without spans (to be fitted)
 * and without areas. `expose` is left to the caller, which knows the cultures.
 */
export function fromClipboard(
	values: readonly ClipboardValue[],
	grid: boolean,
	newKey: () => string = () => crypto.randomUUID(),
): TakenBlock[] {
	const gridValue = values.find((v) => v.type === CLIPBOARD_GRID_BLOCK)?.value;
	const blockValue = values.find((v) => v.type === CLIPBOARD_BLOCK)?.value;
	const source =
		grid && isClipboardBlockValue(gridValue) ? gridValue : isClipboardBlockValue(blockValue) ? blockValue : null;
	if (!source?.layout?.length) return [];
	const fromGrid = source === gridValue;

	const blocks: TakenBlock[] = source.layout.map((layoutItem) => {
		const item: LayoutItem = fromGrid
			? layoutItem
			: grid
				? { contentKey: layoutItem.contentKey, settingsKey: layoutItem.settingsKey ?? null, rowSpan: 1, areas: [] }
				: { contentKey: layoutItem.contentKey, settingsKey: layoutItem.settingsKey ?? null };
		const { content, settings } = layoutKeys(item);
		return {
			item,
			contentData: source.contentData.filter((d) => content.has(d.key)),
			settingsData: (source.settingsData ?? []).filter((d) => settings.has(d.key)),
			expose: [],
		};
	});

	const keys = new Set<string>();
	for (const block of blocks) {
		const { content, settings } = layoutKeys(block.item);
		[...content, ...settings].forEach((key) => keys.add(key));
		nestedBlockKeys([block.contentData, block.settingsData], keys);
	}
	const renamed = new Map([...keys].map((key) => [key, newKey()]));
	return blocks.map((block) => rekey(block, renamed) as TakenBlock);
}
