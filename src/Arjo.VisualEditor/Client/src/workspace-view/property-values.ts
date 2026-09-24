/**
 * Finding and replacing a property value in the document workspace's values: a document property, or a property of a
 * block anywhere inside a block editor value (Block List, Block Grid, Single Block, nested in each other).
 * Block editor values are `{ layout, contentData: [{ key, contentTypeKey, values: [{ alias, culture, segment, value }] }],
 * settingsData, expose }`; marker targets point at a block by its content key (ADR 0002).
 */
import type { TargetRef } from '../protocol/index.js';

export interface PropertyValueModel {
	alias: string;
	culture: string | null;
	segment: string | null;
	value?: unknown;
}

export interface BlockData {
	key: string;
	contentTypeKey: string;
	values: PropertyValueModel[];
}

/** Where a target's value lives. */
export interface ValueLocation {
	/** The document property holding it (for a block property: the block editor property the block is in). */
	property: PropertyValueModel;
	/** For a block property: the block's content key and element type. */
	block: { key: string; contentTypeKey: string } | null;
	/** The target's current value. */
	value: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const sameVariant = (v: PropertyValueModel, alias: string, culture: string | null) =>
	v.alias === alias && (v.culture ?? null) === culture && (v.segment ?? null) === null;

function isBlockData(v: unknown): v is BlockData {
	return isObj(v) && typeof v.key === 'string' && typeof v.contentTypeKey === 'string' && Array.isArray(v.values);
}

/** A value's block editor value: itself, or a rich text value's `blocks`. */
const blockValueOf = (value: unknown) => (isObj(value) && isObj(value.blocks) ? value.blocks : value);

/** The block with content key `key` anywhere inside `value`. */
function findBlock(value: unknown, key: string): BlockData | null {
	value = blockValueOf(value);
	if (!isObj(value) || !Array.isArray(value.contentData)) return null;
	for (const block of value.contentData) {
		if (!isBlockData(block)) continue;
		if (block.key === key) return block;
		for (const v of block.values) {
			const found = findBlock(v.value, key);
			if (found) return found;
		}
	}
	return null;
}

/**
 * Finds a target's value. Document properties are matched by alias and culture. A block is looked for in every
 * block editor value, the active culture's (and invariant ones) first.
 */
export function locateValue(
	values: readonly PropertyValueModel[],
	target: TargetRef,
	activeCulture: string | null,
): ValueLocation | null {
	if (target.kind !== 'Property' || !target.alias) return null;

	if (!target.ownerIsBlock) {
		const property = values.find((v) => sameVariant(v, target.alias!, target.culture));
		return property ? { property, block: null, value: property.value } : null;
	}

	const rank = (v: PropertyValueModel) => ((v.culture ?? null) === activeCulture ? 0 : v.culture == null ? 1 : 2);
	for (const property of [...values].sort((a, b) => rank(a) - rank(b))) {
		const block = findBlock(property.value, target.ownerKey);
		const value = block?.values.find((v) => sameVariant(v, target.alias!, target.culture));
		if (block && value) {
			return { property, block: { key: block.key, contentTypeKey: block.contentTypeKey }, value: value.value };
		}
	}
	return null;
}

/**
 * A copy of block editor value `value` with block `blockKey`'s property `alias` (and culture) set to `newValue`.
 * Only the objects on the way to it are copied. Returns `value` itself when the block isn't found.
 */
export function withBlockPropertyValue(
	value: unknown,
	blockKey: string,
	alias: string,
	culture: string | null,
	newValue: unknown,
	data: BlockDataKind = 'contentData',
): unknown {
	return withBlockData(value, blockKey, data, (block) => ({
		...block,
		values: upsert(block.values, alias, culture, newValue),
	}));
}

/** Block content, or block settings. */
export type BlockDataKind = 'contentData' | 'settingsData';

/** `values` with the value for `alias`/`culture` set, added when the block has no value for it yet. */
function upsert(
	values: PropertyValueModel[],
	alias: string,
	culture: string | null,
	value: unknown,
): PropertyValueModel[] {
	const index = values.findIndex((v) => sameVariant(v, alias, culture));
	if (index < 0) return [...values, { alias, culture, segment: null, value }];
	const copy = [...values];
	copy[index] = { ...values[index], value };
	return copy;
}

/**
 * A copy of block editor value `value` with the content (or settings) entry keyed `key` replaced by `update(entry)`,
 * wherever it is: nested in other blocks' values, or in rich text. Only the objects on the way are copied; returns
 * `value` itself when the entry isn't found.
 */
export function withBlockData(
	value: unknown,
	key: string,
	data: BlockDataKind,
	update: (entry: BlockData) => BlockData,
): unknown {
	// Rich text: the blocks are in its `blocks`.
	if (isObj(value) && isObj(value.blocks)) {
		const blocks = withBlockData(value.blocks, key, data, update);
		return blocks === value.blocks ? value : { ...value, blocks };
	}
	if (!isObj(value) || !Array.isArray(value.contentData)) return value;

	let changed = false;
	const entries = (list: unknown) =>
		Array.isArray(list)
			? list.map((entry: unknown) => {
					if (!isBlockData(entry)) return entry;
					if (entry.key === key) {
						changed = true;
						return update(entry);
					}
					return entry;
				})
			: list;
	const next: Record<string, unknown> = { ...value, [data]: entries(value[data]) };
	if (changed) return next;

	// Not here: look in the blocks' own values (nested block editors, rich text).
	const contentData = value.contentData.map((entry: unknown) => {
		if (!isBlockData(entry)) return entry;
		const values = entry.values.map((v) => {
			const nested = withBlockData(v.value, key, data, update);
			return nested === v.value ? v : { ...v, value: nested };
		});
		return values.some((v, i) => v !== entry.values[i]) ? { ...entry, values } : entry;
	});
	return contentData.some((entry, i) => entry !== (value.contentData as unknown[])[i])
		? { ...value, contentData }
		: value;
}

/** A block of the document, as the side panel edits it (#25). */
export interface LocatedBlock {
	/** The document property the block is in (a block editor, possibly with the block nested further down). */
	property: PropertyValueModel;
	content: BlockData;
	/** Its settings, when its block type has them. */
	settings: BlockData | null;
}

/** The layout item for `contentKey` (in a layout, or a grid area), for its settings key. */
function findLayoutItem(node: unknown, contentKey: string): Record<string, unknown> | null {
	if (Array.isArray(node)) {
		for (const item of node) {
			const found = findLayoutItem(item, contentKey);
			if (found) return found;
		}
		return null;
	}
	if (!isObj(node)) return null;
	if (node.contentKey === contentKey) return node;
	for (const child of Object.values(node)) {
		const found = findLayoutItem(child, contentKey);
		if (found) return found;
	}
	return null;
}

/** The block editor value directly holding block `key` in its contentData, anywhere inside `value`. */
function findBlockValue(value: unknown, key: string): Record<string, unknown> | null {
	value = blockValueOf(value);
	if (!isObj(value) || !Array.isArray(value.contentData)) return null;
	if (value.contentData.some((entry) => isBlockData(entry) && entry.key === key)) return value;
	for (const entry of value.contentData) {
		if (!isBlockData(entry)) continue;
		for (const v of entry.values) {
			const found = findBlockValue(v.value, key);
			if (found) return found;
		}
	}
	return null;
}

/** Finds a block by content key: its content, its settings and the document property it is in. */
export function locateBlock(
	values: readonly PropertyValueModel[],
	contentKey: string,
	activeCulture: string | null,
): LocatedBlock | null {
	const rank = (v: PropertyValueModel) => ((v.culture ?? null) === activeCulture ? 0 : v.culture == null ? 1 : 2);
	for (const property of [...values].sort((a, b) => rank(a) - rank(b))) {
		const holder = findBlockValue(property.value, contentKey);
		if (!holder) continue;
		const content = (holder.contentData as unknown[]).find((e) => isBlockData(e) && e.key === contentKey) as BlockData;
		const settingsKey = findLayoutItem(holder.layout, contentKey)?.settingsKey;
		const settings =
			typeof settingsKey === 'string' && Array.isArray(holder.settingsData)
				? ((holder.settingsData as unknown[]).find((e) => isBlockData(e) && e.key === settingsKey) as
						BlockData | undefined)
				: undefined;
		return { property, content, settings: settings ?? null };
	}
	return null;
}

/** Whether an element's text shows `value` as it is stored (the template didn't transform it). */
export function showsValue(text: string, value: unknown): boolean {
	const normalise = (s: string) => s.replace(/\r\n?/g, '\n').trim();
	return typeof value === 'string' ? normalise(text) === normalise(value) : text.trim() === '' && value == null;
}

/**
 * The content key of the block whose settings have key `settingsKey`: block layouts (at any depth, including grid
 * areas) pair them as `{ contentKey, settingsKey }`. Null when not found.
 */
export function contentKeyOfSettings(values: readonly PropertyValueModel[], settingsKey: string): string | null {
	const search = (node: unknown): string | null => {
		if (Array.isArray(node)) {
			for (const item of node) {
				const found = search(item);
				if (found) return found;
			}
			return null;
		}
		if (!isObj(node)) return null;
		if (node.settingsKey === settingsKey && typeof node.contentKey === 'string') return node.contentKey;
		for (const child of Object.values(node)) {
			const found = search(child);
			if (found) return found;
		}
		return null;
	};
	return search(values.map((v) => v.value));
}

/**
 * A copy of `value` with the block editor value that holds block `contentKey` replaced by `update(blockValue)`,
 * wherever it is (nested in other blocks' values, or a rich text value's `blocks`). Returns `value` itself when the
 * block isn't found or `update` changes nothing.
 */
export function withBlockEditorValue(
	value: unknown,
	contentKey: string,
	update: (blockValue: Record<string, unknown>) => Record<string, unknown>,
): unknown {
	if (isObj(value) && isObj(value.blocks)) {
		const blocks = withBlockEditorValue(value.blocks, contentKey, update);
		return blocks === value.blocks ? value : { ...value, blocks };
	}
	if (!isObj(value) || !Array.isArray(value.contentData)) return value;
	if (value.contentData.some((entry) => isBlockData(entry) && entry.key === contentKey)) return update(value);

	const contentData = value.contentData.map((entry: unknown) => {
		if (!isBlockData(entry)) return entry;
		const values = entry.values.map((v) => {
			const nested = withBlockEditorValue(v.value, contentKey, update);
			return nested === v.value ? v : { ...v, value: nested };
		});
		return values.some((v, i) => v !== entry.values[i]) ? { ...entry, values } : entry;
	});
	return contentData.some((entry, i) => entry !== (value.contentData as unknown[])[i])
		? { ...value, contentData }
		: value;
}

/** The block editor property that directly holds a block: whose property it is, which, and its culture. */
export interface BlockHolder {
	/** The document property the block is in (at any depth). */
	property: PropertyValueModel;
	/** The holding property's owner: null for the document, else a block's content key. */
	ownerKey: string | null;
	alias: string;
	culture: string | null;
}

/** Finds the block editor property holding block `contentKey` directly (e.g. the nested Block Grid it's an item of). */
export function locateBlockHolder(
	values: readonly PropertyValueModel[],
	contentKey: string,
	activeCulture: string | null,
): BlockHolder | null {
	const search = (
		value: unknown,
		ownerKey: string | null,
		alias: string,
		culture: string | null,
		property: PropertyValueModel,
	): BlockHolder | null => {
		const blockValue = blockValueOf(value);
		if (!isObj(blockValue) || !Array.isArray(blockValue.contentData)) return null;
		if (blockValue.contentData.some((entry) => isBlockData(entry) && entry.key === contentKey)) {
			return { property, ownerKey, alias, culture };
		}
		for (const entry of blockValue.contentData) {
			if (!isBlockData(entry)) continue;
			for (const v of entry.values) {
				const found = search(v.value, entry.key, v.alias, v.culture ?? null, property);
				if (found) return found;
			}
		}
		return null;
	};
	const rank = (v: PropertyValueModel) => ((v.culture ?? null) === activeCulture ? 0 : v.culture == null ? 1 : 2);
	for (const property of [...values].sort((a, b) => rank(a) - rank(b))) {
		const found = search(property.value, null, property.alias, property.culture ?? null, property);
		if (found) return found;
	}
	return null;
}
