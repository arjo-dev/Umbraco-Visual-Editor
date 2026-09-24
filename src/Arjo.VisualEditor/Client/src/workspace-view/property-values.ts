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

interface BlockData {
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

/** The block with content key `key` anywhere inside `value`. */
function findBlock(value: unknown, key: string): BlockData | null {
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
): unknown {
	if (!isObj(value) || !Array.isArray(value.contentData)) return value;
	let changed = false;
	const contentData = value.contentData.map((block: unknown) => {
		if (!isBlockData(block)) return block;
		const values = block.values.map((v) => {
			if (block.key === blockKey) {
				if (!sameVariant(v, alias, culture)) return v;
				changed = true;
				return { ...v, value: newValue };
			}
			const nested = withBlockPropertyValue(v.value, blockKey, alias, culture, newValue);
			if (nested === v.value) return v;
			changed = true;
			return { ...v, value: nested };
		});
		return values.some((v, i) => v !== block.values[i]) ? { ...block, values } : block;
	});
	return changed ? { ...value, contentData } : value;
}

/** Whether an element's text shows `value` as it is stored (the template didn't transform it). */
export function showsValue(text: string, value: unknown): boolean {
	const normalise = (s: string) => s.replace(/\r\n?/g, '\n').trim();
	return typeof value === 'string' ? normalise(text) === normalise(value) : text.trim() === '' && value == null;
}
