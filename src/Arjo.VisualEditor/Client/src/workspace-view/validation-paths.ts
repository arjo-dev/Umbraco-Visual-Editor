/**
 * Validation messages (#23) → what they're about on the page. The workspace's validation context keys messages by
 * JSON-path-like data paths, built with Umbraco's query helpers (`UmbDataPathPropertyValueQuery`,
 * `UmbDataPathBlockElementDataQuery`):
 *
 * - document property: `$.values[?(@.alias == 'title' && @.culture == 'en-US' && @.segment == null)].value`
 * - block property:    `$.values[?(@.alias == 'grid' …)].value.contentData[?(@.key == '…')].values[?(@.alias == 'caption' …)].value`
 * - block settings:    `….settingsData[?(@.key == '…')].values[…]`
 * - document name:     `$.variants[?(@.culture == 'en-US' && @.segment == null)].name`
 */
import type { TargetRef } from '../protocol/index.js';

export interface ParsedValidationPath {
	/** The top-level (document) property the message is under; null for the document name. */
	documentProperty: { alias: string; culture: string | null } | null;
	/** Content keys of the blocks the message is inside, outermost first. */
	blockKeys: string[];
	/** The property the message is about, when it's inside a block: its alias and culture. */
	blockProperty: { alias: string; culture: string | null } | null;
	/** Inside a block's settings rather than its content. */
	inSettings: boolean;
	/** The document name of a variant (`$.variants[…].name`). */
	variantName: { culture: string | null } | null;
}

const SEGMENT = /\.(values|contentData|settingsData|variants)\[\?\(([^)]*)\)\]/g;

/** Values of `@.name == 'value'` / `@.name == null` in a filter. */
function filterValues(filter: string): Record<string, string | null> {
	const values: Record<string, string | null> = {};
	for (const match of filter.matchAll(/@\.(\w+)\s*==\s*(?:'((?:[^'\\]|\\.)*)'|(null))/g)) {
		values[match[1]] = match[3] === 'null' ? null : match[2];
	}
	return values;
}

/** Parses a validation message path; null for paths it doesn't understand (e.g. index-based ones). */
export function parseValidationPath(path: string): ParsedValidationPath | null {
	if (!path.startsWith('$.')) return null;
	const result: ParsedValidationPath = {
		documentProperty: null,
		blockKeys: [],
		blockProperty: null,
		inSettings: false,
		variantName: null,
	};
	let segments = 0;
	for (const [, kind, filter] of path.matchAll(SEGMENT)) {
		const values = filterValues(filter);
		segments++;
		if (kind === 'variants') {
			result.variantName = { culture: values.culture ?? null };
		} else if (kind === 'values' && values.alias) {
			const property = { alias: values.alias, culture: values.culture ?? null };
			if (!result.documentProperty) result.documentProperty = property;
			else result.blockProperty = property;
		} else if ((kind === 'contentData' || kind === 'settingsData') && values.key) {
			result.blockKeys.push(values.key);
			result.inSettings = kind === 'settingsData';
			result.blockProperty = null;
		}
	}
	return segments ? result : null;
}

const blockRef = (key: string): TargetRef => ({
	kind: 'Block',
	ownerKey: key,
	ownerIsBlock: true,
	alias: null,
	culture: null,
});

/**
 * The canvas targets a message marks: the property (a document property, or a block's content property) and every
 * block it is inside. A block settings error marks the block itself.
 */
export function targetsOf(
	parsed: ParsedValidationPath,
	documentKey: string,
): { target: TargetRef | null; blocks: TargetRef[] } {
	const blocks = parsed.blockKeys.map(blockRef);
	if (!parsed.documentProperty) return { target: null, blocks };
	if (!parsed.blockKeys.length) {
		return {
			target: {
				kind: 'Property',
				ownerKey: documentKey,
				ownerIsBlock: false,
				alias: parsed.documentProperty.alias,
				culture: parsed.documentProperty.culture,
			},
			blocks,
		};
	}
	const owner = parsed.blockKeys[parsed.blockKeys.length - 1];
	if (parsed.inSettings || !parsed.blockProperty) return { target: blockRef(owner), blocks };
	return {
		target: {
			kind: 'Property',
			ownerKey: owner,
			ownerIsBlock: true,
			alias: parsed.blockProperty.alias,
			culture: parsed.blockProperty.culture,
		},
		blocks,
	};
}

/** Whether a message belongs to the variant being edited: its culture's values, or invariant ones. */
export function inCulture(parsed: ParsedValidationPath, culture: string | null): boolean {
	const own = parsed.variantName?.culture ?? parsed.documentProperty?.culture ?? null;
	return own === null || own === culture;
}
