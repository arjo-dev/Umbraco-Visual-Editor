/**
 * The Block Grid data type's rules for where a block may go (#27), from its configuration:
 *
 * `{ blocks: [{ contentElementTypeKey, groupKey, allowAtRoot, allowInAreas, columnSpanOptions: [{ columnSpan }],
 *    areas: [{ key, alias, columnSpan, maxAllowed, specifiedAllowance: [{ elementTypeKey | groupKey }] }] }],
 *   gridColumns, validationLimit: { min, max } }`
 *
 * Items at the grid's root lay out on `gridColumns` columns; items in an area on as many columns as the area spans.
 */
import { fitSpan } from './block-operations.js';

export interface GridAreaConfig {
	key: string;
	alias: string;
	columnSpan?: number;
	maxAllowed?: number | null;
	specifiedAllowance?: Array<{ elementTypeKey?: string | null; groupKey?: string | null }>;
}

export interface GridBlockConfig {
	contentElementTypeKey: string;
	groupKey?: string | null;
	allowAtRoot?: boolean;
	allowInAreas?: boolean;
	columnSpanOptions?: Array<{ columnSpan: number }>;
	areas?: GridAreaConfig[];
}

export interface GridConfig {
	blocks: GridBlockConfig[];
	gridColumns?: number | null;
	validationLimit?: { max?: number | null } | null;
}

/** The grid configuration from a data type's configuration values (`[{ alias, value }]`). */
export function gridConfigOf(values: ReadonlyArray<{ alias: string; value: unknown }>): GridConfig {
	const get = (alias: string) => values.find((v) => v.alias === alias)?.value;
	return {
		blocks: (get('blocks') as GridBlockConfig[] | undefined) ?? [],
		gridColumns: (get('gridColumns') as number | undefined) ?? null,
		validationLimit: (get('validationLimit') as GridConfig['validationLimit']) ?? null,
	};
}

/** An area of a block type, by key, or else by alias. */
export function areaOf(config: GridConfig, ownerTypeKey: string, key?: string | null, alias?: string | null) {
	const areas = config.blocks.find((b) => b.contentElementTypeKey === ownerTypeKey)?.areas ?? [];
	return areas.find((a) => (key ? a.key === key : a.alias === alias)) ?? null;
}

/** How many columns a container lays blocks out on: an area's span, or the grid's columns at the root. */
export const columnsIn = (config: GridConfig, area: GridAreaConfig | null) =>
	area?.columnSpan ?? config.gridColumns ?? 12;

/** The column spans a block type allows (empty: any). */
export const spansOf = (config: GridConfig, typeKey: string) =>
	config.blocks.find((b) => b.contentElementTypeKey === typeKey)?.columnSpanOptions?.map((o) => o.columnSpan) ?? [];

/**
 * Whether a block of `typeKey`, `span` columns wide, may go into the grid's root (`area` null) or an area that holds
 * `count` blocks already; and if so, the span it gets there (it may need to be narrower).
 */
export function checkGridDrop(
	config: GridConfig,
	typeKey: string,
	span: number | null,
	area: GridAreaConfig | null,
	count: number,
): { ok: true; columnSpan: number } | { ok: false; reason: string } {
	const block = config.blocks.find((b) => b.contentElementTypeKey === typeKey);
	if (!block) return { ok: false, reason: 'This grid doesn’t allow this type of block.' };

	if (!area) {
		if (block.allowAtRoot === false) return { ok: false, reason: 'This type of block can only go in an area.' };
		const max = config.validationLimit?.max;
		if (max && count >= max) return { ok: false, reason: `The grid is full: it allows at most ${max} blocks.` };
	} else {
		const allowances = area.specifiedAllowance ?? [];
		const allowed = allowances.length
			? allowances.some(
					(a) => (a.elementTypeKey && a.elementTypeKey === typeKey) || (a.groupKey && a.groupKey === block.groupKey),
				)
			: block.allowInAreas !== false;
		if (!allowed) return { ok: false, reason: `The ${area.alias} area doesn’t allow this type of block.` };
		if (area.maxAllowed && count >= area.maxAllowed) {
			return { ok: false, reason: `The ${area.alias} area is full: it allows at most ${area.maxAllowed} blocks.` };
		}
	}

	const columns = columnsIn(config, area);
	const columnSpan = fitSpan(Math.min(span ?? columns, columns), columns, spansOf(config, typeKey));
	if (columnSpan === null) return { ok: false, reason: 'This block is too wide to go there.' };
	return { ok: true, columnSpan };
}
