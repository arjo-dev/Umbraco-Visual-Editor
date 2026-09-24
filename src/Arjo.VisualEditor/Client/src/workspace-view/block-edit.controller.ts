import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UmbDataTypeDetailRepository } from '@umbraco-cms/backoffice/data-type';
import { UmbDocumentTypeDetailRepository } from '@umbraco-cms/backoffice/document-type';
import { UMB_NOTIFICATION_CONTEXT } from '@umbraco-cms/backoffice/notification';
import { UMB_CLIPBOARD_CONTEXT, type UmbClipboardEntryDetailModel } from '@umbraco-cms/backoffice/clipboard';
import type { BlockPosition } from '../protocol/index.js';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { umbConfirmModal } from '@umbraco-cms/backoffice/modal';
import { UmbVariantId } from '@umbraco-cms/backoffice/variant';
import {
	duplicateBlock,
	isBlockEditorValue,
	moveBlock,
	moveBlockTo,
	putBlock,
	removeBlock,
	takeBlock,
	type BlockEditorValue,
	type TakenBlock,
	fitSpan,
	fromClipboard,
	layoutPosition,
	newBlock,
	toClipboardValues,
	putBlockInArea,
	withColumnSpan,
} from './block-operations.js';
import {
	allowedInGrid,
	areaOf,
	checkGridDrop,
	columnsIn,
	gridConfigOf,
	spansOf,
	type GridAreaConfig,
	type GridConfig,
} from './grid-rules.js';
import type { CatalogueBlockGroup, CatalogueBlockType } from './visual-editor-block-picker.element.js';
import {
	locateBlock,
	locateBlockHolder,
	locateValue,
	withBlockEditorValue,
	withBlockPropertyValue,
	type BlockDataKind,
	type PropertyValueModel,
} from './property-values.js';

/** What the canvas block toolbar does to a block (#25). */
export type BlockLayoutAction = 'moveUp' | 'moveDown' | 'duplicate' | 'delete';

/**
 * Changes blocks in the document workspace (#25): the block toolbar's actions (move, duplicate, delete) and the side
 * panel's edits to a block's content and settings. Blocks are found by content key wherever they are (nested in
 * other blocks, in grid areas, in rich text); the change is written to the document property they're in, as an
 * ordinary workspace change: Save stores it, and the canvas re-renders it.
 */
/** The layout items of a grid's root (`areaOwnerKey` null) or of one block's area. */
function containerItems(value: BlockEditorValue, areaOwnerKey: string | null, areaKey: string | null) {
	if (!areaOwnerKey) return value.layout['Umbraco.BlockGrid'] ?? [];
	const owner = layoutPosition(value, areaOwnerKey)?.item;
	return owner?.areas?.find((a) => a.key === areaKey)?.items ?? [];
}

/** A block editor value to put into: the value, or an empty one when the property has none yet. */
const asBlockValue = (value: unknown): BlockEditorValue =>
	isBlockEditorValue(value) ? value : { layout: {}, contentData: [], settingsData: [], expose: [] };

export class ArjoBlockEditController extends UmbControllerBase {
	#workspace?: typeof UMB_DOCUMENT_WORKSPACE_CONTEXT.TYPE;

	constructor(host: UmbControllerHost) {
		super(host);
		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => (this.#workspace = workspace));
	}

	/** Whether the user may change the document property holding `blockKey`. */
	async canEdit(blockKey: string, activeCulture: string | null): Promise<boolean> {
		const property =
			this.#workspace && locateBlock(this.#workspace.getValues() ?? [], blockKey, activeCulture)?.property;
		return property ? this.#canWrite(property, activeCulture) : false;
	}

	/**
	 * Applies a toolbar action. Returns the block to select afterwards (the copy after a duplicate, null after a
	 * delete), or undefined when nothing changed (not allowed, cancelled, or not possible, e.g. moving the first up).
	 */
	async apply(
		blockKey: string,
		action: BlockLayoutAction,
		activeCulture: string | null,
	): Promise<string | null | undefined> {
		const workspace = this.#workspace;
		const located = workspace && locateBlock(workspace.getValues() ?? [], blockKey, activeCulture);
		if (!workspace || !located || !(await this.#canWrite(located.property, activeCulture))) return undefined;

		if (action === 'delete') {
			try {
				await umbConfirmModal(this, {
					headline: 'Delete block',
					content: 'Delete this block, and any blocks inside it?',
					color: 'danger',
					confirmLabel: 'Delete',
				});
			} catch {
				return undefined; // cancelled
			}
		}

		let selected: string | null = blockKey;
		const next = withBlockEditorValue(located.property.value, blockKey, (value) => {
			if (!isBlockEditorValue(value)) return value;
			switch (action) {
				case 'moveUp':
					return moveBlock(value, blockKey, -1);
				case 'moveDown':
					return moveBlock(value, blockKey, 1);
				case 'delete':
					selected = null;
					return removeBlock(value, blockKey);
				case 'duplicate': {
					const copy = duplicateBlock(value, blockKey);
					if (!copy) return value;
					selected = copy.contentKey;
					return copy.value;
				}
			}
		});
		if (next === located.property.value) return undefined;
		await this.#set(located.property, next);
		return selected;
	}

	/**
	 * Moves a block to a Block List position (#26, a drop on the canvas). Within its own list it's a reorder. Into
	 * another list only when that property allows the block's type and has room (else a notification says why).
	 * Returns whether the document changed.
	 */
	async moveTo(blockKey: string, to: BlockPosition, activeCulture: string | null): Promise<boolean> {
		// Grid drops say which area (or the root): #27.
		if (to.areaOwnerKey !== undefined) return this.#moveInGrid(blockKey, to, activeCulture);
		const workspace = this.#workspace;
		const values = workspace?.getValues() ?? [];
		const source = workspace && locateBlock(values, blockKey, activeCulture);
		const target = workspace && this.#listAt(to, activeCulture);
		if (!workspace || !source || !target || !(await this.#canWrite(source.property, activeCulture))) return false;
		if (target.property !== source.property && !(await this.#canWrite(target.property, activeCulture))) return false;

		// The same list: a reorder.
		let holder: unknown;
		withBlockEditorValue(source.property.value, blockKey, (value) => {
			holder = value;
			return value;
		});
		if (holder === target.value) {
			const next = withBlockEditorValue(source.property.value, blockKey, (value) =>
				isBlockEditorValue(value) ? moveBlockTo(value, blockKey, to.index) : value,
			);
			if (next === source.property.value) return false;
			await this.#set(source.property, next);
			return true;
		}

		const refusal = await this.#refuseMove(source.content.contentTypeKey, to, target.value, activeCulture);
		if (refusal) {
			const notifications = await this.getContext(UMB_NOTIFICATION_CONTEXT);
			notifications?.peek('warning', { data: { headline: 'The block can’t go there', message: refusal } });
			return false;
		}

		// Take it out of its list, then put it into the other one (in the same document property, or another).
		let taken: TakenBlock | null = null;
		const without = withBlockEditorValue(source.property.value, blockKey, (value) => {
			const result = isBlockEditorValue(value) ? takeBlock(value, blockKey) : null;
			taken = result?.taken ?? null;
			return result?.value ?? value;
		});
		const moving = taken as TakenBlock | null;
		if (!moving) return false;
		const put = (value: unknown) => putBlock(asBlockValue(value), 'Umbraco.BlockList', moving, to.index);

		if (target.property === source.property) {
			await this.#set(source.property, this.#withList(without, to, target.culture, put));
		} else {
			await this.#set(source.property, without);
			await this.#set(target.property, this.#withList(target.property.value, to, target.culture, put));
		}
		return true;
	}

	/** The Block List value at a position's owner and property: a document property, or a block's property. */
	#listAt(to: BlockPosition, activeCulture: string | null) {
		const values = this.#workspace?.getValues() ?? [];
		const ownerIsBlock = to.ownerKey !== this.#workspace?.getUnique();
		for (const culture of [activeCulture, null]) {
			const location = locateValue(
				values,
				{ kind: 'Property', ownerKey: to.ownerKey, ownerIsBlock, alias: to.propertyAlias, culture },
				activeCulture,
			);
			if (location) return { property: location.property, value: location.value, culture };
		}
		return null;
	}

	/** A document property value with the Block List at `to` replaced by `update(list)`. */
	#withList(value: unknown, to: BlockPosition, culture: string | null, update: (list: unknown) => unknown) {
		if (to.ownerKey === this.#workspace?.getUnique()) return update(value);
		let current: unknown;
		withBlockEditorValue(value, to.ownerKey, (holder) => {
			const owner = (holder.contentData as Array<{ key: string; values: PropertyValueModel[] }>).find(
				(entry) => entry.key === to.ownerKey,
			);
			current = owner?.values.find((v) => v.alias === to.propertyAlias && (v.culture ?? null) === culture)?.value;
			return holder;
		});
		return withBlockPropertyValue(value, to.ownerKey, to.propertyAlias, culture, update(current));
	}

	/** Why a block of `contentTypeKey` can't go into the list at `to`, or null when it can. */
	async #refuseMove(contentTypeKey: string, to: BlockPosition, list: unknown, activeCulture: string | null) {
		const config = await this.#listConfiguration(to, activeCulture);
		if (!config) return null;
		const blocks = config.find((c) => c.alias === 'blocks')?.value as
			Array<{ contentElementTypeKey?: string }> | undefined;
		if (blocks?.length && !blocks.some((b) => b.contentElementTypeKey === contentTypeKey)) {
			return 'That list doesn’t allow this type of block.';
		}
		const limit = config.find((c) => c.alias === 'validationLimit')?.value as { max?: number } | undefined;
		const count = isBlockEditorValue(list) ? (list.layout['Umbraco.BlockList']?.length ?? 0) : 0;
		if (limit?.max && count >= limit.max) return `That list is full: it allows at most ${limit.max} blocks.`;
		return null;
	}

	/** The data type configuration of the Block List property at `to`. */
	async #listConfiguration(to: BlockPosition, activeCulture: string | null) {
		const documentKey = this.#workspace?.getUnique();
		return this.#configurationOf(to.ownerKey === documentKey ? null : to.ownerKey, to.propertyAlias, activeCulture);
	}

	/** The data type configuration of a block editor property: the document's (`ownerKey` null) or a block's. */
	async #configurationOf(ownerKey: string | null, alias: string, activeCulture: string | null) {
		const workspace = this.#workspace;
		if (!workspace) return null;
		let dataTypeKey: string | undefined;
		if (!ownerKey) {
			dataTypeKey = (await workspace.structure.getPropertyStructureByAlias(alias))?.dataType.unique;
		} else {
			const owner = locateBlock(workspace.getValues() ?? [], ownerKey, activeCulture);
			if (!owner) return null;
			const { data: elementType } = await new UmbDocumentTypeDetailRepository(this).requestByUnique(
				owner.content.contentTypeKey,
			);
			dataTypeKey = elementType?.properties.find((p) => p.alias === alias)?.dataType.unique;
		}
		if (!dataTypeKey) return null;
		const { data } = await new UmbDataTypeDetailRepository(this).requestByUnique(dataTypeKey);
		return data?.values ?? null;
	}

	/** Tells the user why something couldn't be done. */
	async #warn(headline: string, message: string) {
		const notifications = await this.getContext(UMB_NOTIFICATION_CONTEXT);
		notifications?.peek('warning', { data: { headline, message } });
	}

	/**
	 * Moves a Block Grid block to the grid's root or an area (#27): a reorder in its own container; otherwise only
	 * where the grid's configuration allows it (type, maximum), with its column span fitted to the new container.
	 */
	async #moveInGrid(blockKey: string, to: BlockPosition, activeCulture: string | null): Promise<boolean> {
		const workspace = this.#workspace;
		const source = workspace && locateBlock(workspace.getValues() ?? [], blockKey, activeCulture);
		const target = workspace && this.#listAt(to, activeCulture);
		if (!workspace || !source || !target || !isBlockEditorValue(target.value)) return false;
		if (!(await this.#canWrite(source.property, activeCulture))) return false;
		if (target.property !== source.property && !(await this.#canWrite(target.property, activeCulture))) return false;

		const values = await this.#listConfiguration(to, activeCulture);
		if (!values) return false;
		const config = gridConfigOf(values);
		const grid = target.value;

		// The area (or root) it goes into, by key, or by the alias the page shows for an empty area.
		let area: ReturnType<typeof areaOf> = null;
		if (to.areaOwnerKey) {
			const ownerType = grid.contentData.find((d) => d.key === to.areaOwnerKey)?.contentTypeKey as string | undefined;
			area = ownerType ? areaOf(config, ownerType, to.areaKey, to.areaAlias) : null;
			if (!area) return false;
		}

		let holder: unknown;
		withBlockEditorValue(source.property.value, blockKey, (value) => {
			holder = value;
			return value;
		});
		const from = isBlockEditorValue(holder) ? layoutPosition(holder, blockKey) : null;
		if (!from) return false;

		// Its own container: a reorder.
		if (holder === grid && from.areaOwnerKey === (to.areaOwnerKey ?? null) && from.areaKey === (area?.key ?? null)) {
			const next = withBlockEditorValue(source.property.value, blockKey, (value) =>
				isBlockEditorValue(value) ? moveBlockTo(value, blockKey, to.index) : value,
			);
			if (next === source.property.value) return false;
			await this.#set(source.property, next);
			return true;
		}

		const count = containerItems(grid, to.areaOwnerKey ?? null, area?.key ?? null).filter(
			(i) => i.contentKey !== blockKey,
		).length;
		const check = checkGridDrop(
			config,
			source.content.contentTypeKey,
			(from.item.columnSpan as number | undefined) ?? null,
			area,
			count,
		);
		if (!check.ok) {
			await this.#warn('The block can’t go there', check.reason);
			return false;
		}

		let taken: TakenBlock | null = null;
		const without = withBlockEditorValue(source.property.value, blockKey, (value) => {
			const result = isBlockEditorValue(value) ? takeBlock(value, blockKey) : null;
			taken = result?.taken ?? null;
			return result?.value ?? value;
		});
		const moving = taken as TakenBlock | null;
		if (!moving) return false;
		const resized: TakenBlock = { ...moving, item: { ...moving.item, columnSpan: check.columnSpan } };
		const put = (value: unknown) =>
			to.areaOwnerKey && area
				? putBlockInArea(asBlockValue(value), to.areaOwnerKey, area.key, resized, to.index)
				: putBlock(asBlockValue(value), 'Umbraco.BlockGrid', resized, to.index);

		if (target.property === source.property) {
			await this.#set(source.property, this.#withList(without, to, target.culture, put));
		} else {
			await this.#set(source.property, without);
			await this.#set(target.property, this.#withList(target.property.value, to, target.culture, put));
		}
		return true;
	}

	/**
	 * Resizes a Block Grid block (#27, its resize handle): the span snaps to the block type's allowed spans that fit
	 * its container. Returns whether the document changed.
	 */
	async resize(blockKey: string, columnSpan: number, activeCulture: string | null): Promise<boolean> {
		const workspace = this.#workspace;
		const values = workspace?.getValues() ?? [];
		const holder = workspace && locateBlockHolder(values, blockKey, activeCulture);
		const block = workspace && locateBlock(values, blockKey, activeCulture);
		if (!workspace || !holder || !block || !(await this.#canWrite(holder.property, activeCulture))) return false;

		const configValues = await this.#configurationOf(holder.ownerKey, holder.alias, activeCulture);
		if (!configValues) return false;
		const config: GridConfig = gridConfigOf(configValues);

		let snapped: number | null = null;
		const next = withBlockEditorValue(holder.property.value, blockKey, (value) => {
			if (!isBlockEditorValue(value)) return value;
			const at = layoutPosition(value, blockKey);
			if (!at) return value;
			const ownerType = at.areaOwnerKey
				? (value.contentData.find((d) => d.key === at.areaOwnerKey)?.contentTypeKey as string | undefined)
				: undefined;
			const area = ownerType ? areaOf(config, ownerType, at.areaKey) : null;
			snapped = fitSpan(columnSpan, columnsIn(config, area), spansOf(config, block.content.contentTypeKey));
			return snapped === null ? value : withColumnSpan(value, blockKey, snapped);
		});
		if (next === holder.property.value) return false;
		await this.#set(holder.property, next);
		return true;
	}

	/**
	 * Adds a block at a position (#28, a "+" on the canvas): the CMS block catalogue, with the block types allowed
	 * there, offers to create one or to paste blocks from the CMS clipboard (#29; entries copied here or in the
	 * standard editor, when all their block types are allowed). Returns the key of the (first) block added, or
	 * undefined when nothing was added (not allowed, full, or the catalogue was closed).
	 */
	async insert(
		at: BlockPosition,
		activeCulture: string | null,
		pick: (
			blocks: CatalogueBlockType[],
			groups: CatalogueBlockGroup[],
			clipboardFilter: (entry: UmbClipboardEntryDetailModel) => Promise<boolean>,
		) => Promise<{ create: string } | { paste: string[] } | null>,
	): Promise<string | undefined> {
		const workspace = this.#workspace;
		const target = workspace && this.#listAt(at, activeCulture);
		if (!workspace || !target || !(await this.#canWrite(target.property, activeCulture))) return undefined;
		const values = await this.#listConfiguration(at, activeCulture);
		if (!values) return undefined;
		const get = (alias: string) => values.find((v) => v.alias === alias)?.value;
		const list = asBlockValue(target.value);

		// What may go there, and whether there's room.
		const isGrid = at.areaOwnerKey !== undefined;
		const grid: GridConfig | null = isGrid ? gridConfigOf(values) : null;
		let area: GridAreaConfig | null = null;
		if (grid && at.areaOwnerKey) {
			const ownerType = list.contentData.find((d) => d.key === at.areaOwnerKey)?.contentTypeKey as string | undefined;
			area = ownerType ? areaOf(grid, ownerType, at.areaKey, at.areaAlias) : null;
			if (!area) return undefined;
		}
		const allowed: Array<
			CatalogueBlockType & {
				settingsElementTypeKey?: string | null;
				rowMinSpan?: number | null;
				areas?: GridAreaConfig[];
			}
		> = grid ? allowedInGrid(grid, area) : ((get('blocks') as CatalogueBlockType[] | undefined) ?? []);
		const inProperty = new Set(
			((get('blocks') as CatalogueBlockType[] | undefined) ?? []).map((b) => b.contentElementTypeKey),
		);
		const count = grid
			? containerItems(list, at.areaOwnerKey ?? null, area?.key ?? null).length
			: (list.layout['Umbraco.BlockList']?.length ?? 0);
		const max = area ? area.maxAllowed : (get('validationLimit') as { max?: number | null } | undefined)?.max;
		if (!allowed.length) {
			await this.#warn('No blocks can go there', 'Its configuration doesn\u2019t allow any block types there.');
			return undefined;
		}
		if (max && count >= max) {
			await this.#warn('There\u2019s no room', `It allows at most ${max} blocks.`);
			return undefined;
		}

		// Clipboard entries that fit: every block type in them allowed in the property, and the blocks themselves here.
		const topTypes = new Set(allowed.map((b) => b.contentElementTypeKey));
		const fits = (blocks: TakenBlock[]) =>
			blocks.length > 0 &&
			blocks.every(
				(b) =>
					topTypes.has(b.contentData.find((d) => d.key === b.item.contentKey)?.contentTypeKey as string) &&
					b.contentData.every((d) => inProperty.has(d.contentTypeKey as string)),
			);
		const clipboardFilter = async (entry: UmbClipboardEntryDetailModel) => fits(fromClipboard(entry.values, isGrid));

		const choice = await pick(
			allowed,
			(get('blockGroups') as CatalogueBlockGroup[] | undefined) ?? [],
			clipboardFilter,
		);
		if (!choice) return undefined;

		let blocks: TakenBlock[];
		if ('paste' in choice) {
			const clipboard = await this.getContext(UMB_CLIPBOARD_CONTEXT);
			const entries = await Promise.all(choice.paste.map((unique) => clipboard?.read(unique)));
			blocks = entries.flatMap((entry) => (entry ? fromClipboard(entry.values, isGrid) : []));
			if (!fits(blocks)) return undefined;
		} else {
			const type = allowed.find((b) => b.contentElementTypeKey === choice.create);
			if (!type) return undefined;
			const columns = grid ? columnsIn(grid, area) : 0;
			blocks = [
				newBlock({
					contentTypeKey: type.contentElementTypeKey,
					settingsTypeKey: type.settingsElementTypeKey ?? null,
					exposeCulture: null,
					grid: grid
						? {
								columnSpan: fitSpan(columns, columns, spansOf(grid, type.contentElementTypeKey)) ?? columns,
								rowSpan: type.rowMinSpan ?? 1,
								areaKeys: type.areas?.map((a) => a.key) ?? [],
							}
						: undefined,
				}),
			];
		}

		// Room for them all, spans that fit (grid), and exposed in the edited culture where their element type varies
		// by culture (as the block editors do).
		if (max && count + blocks.length > max) {
			await this.#warn('There\u2019s no room', `It allows at most ${max} blocks.`);
			return undefined;
		}
		const variesByCulture = new Map<string, boolean>();
		const repository = new UmbDocumentTypeDetailRepository(this);
		for (const block of blocks) {
			if (grid) {
				const typeKey = block.contentData.find((d) => d.key === block.item.contentKey)?.contentTypeKey as string;
				const check = checkGridDrop(grid, typeKey, (block.item.columnSpan as number | undefined) ?? null, area, 0);
				if (!check.ok) {
					await this.#warn('The block can\u2019t go there', check.reason);
					return undefined;
				}
				block.item.columnSpan = check.columnSpan;
				block.item.rowSpan ??= 1;
			}
			for (const data of block.contentData) {
				const typeKey = data.contentTypeKey as string;
				if (!variesByCulture.has(typeKey)) {
					const { data: type } = await repository.requestByUnique(typeKey);
					variesByCulture.set(typeKey, !!type?.variesByCulture);
				}
				block.expose = [
					...block.expose.filter((e) => e.contentKey !== data.key),
					{ contentKey: data.key, culture: variesByCulture.get(typeKey) ? activeCulture : null, segment: null },
				];
			}
		}

		const put = (value: unknown) =>
			blocks.reduce(
				(next, block, i) =>
					grid
						? at.areaOwnerKey && area
							? putBlockInArea(next, at.areaOwnerKey, area.key, block, at.index + i)
							: putBlock(next, 'Umbraco.BlockGrid', block, at.index + i)
						: putBlock(next, 'Umbraco.BlockList', block, at.index + i),
				asBlockValue(value),
			);
		await this.#set(target.property, this.#withList(target.property.value, at, target.culture, put));
		return blocks[0].item.contentKey;
	}

	/**
	 * Copies a block to the CMS clipboard (#29), in the entry format the standard block editors use, so it can be
	 * pasted there too. Returns whether it was copied.
	 */
	async copy(blockKey: string, label: string, activeCulture: string | null): Promise<boolean> {
		const workspace = this.#workspace;
		const block = workspace && locateBlock(workspace.getValues() ?? [], blockKey, activeCulture);
		if (!block) return false;
		let taken: TakenBlock | null = null;
		let grid = false;
		withBlockEditorValue(block.property.value, blockKey, (value) => {
			if (isBlockEditorValue(value)) {
				taken = takeBlock(value, blockKey)?.taken ?? null;
				grid = layoutPosition(value, blockKey)?.editorAlias === 'Umbraco.BlockGrid';
			}
			return value;
		});
		const copied = taken as TakenBlock | null;
		if (!copied) return false;
		const { data: type } = await new UmbDocumentTypeDetailRepository(this).requestByUnique(
			block.content.contentTypeKey,
		);
		const clipboard = await this.getContext(UMB_CLIPBOARD_CONTEXT);
		const notifications = await this.getContext(UMB_NOTIFICATION_CONTEXT);
		try {
			await clipboard?.write({
				name: label,
				icon: type?.icon ?? 'icon-document',
				values: toClipboardValues(copied, grid),
			});
			notifications?.peek('positive', { data: { message: 'Copied to the clipboard' } });
			return true;
		} catch (error) {
			notifications?.peek('danger', { data: { message: error instanceof Error ? error.message : String(error) } });
			return false;
		}
	}

	/** Sets one of a block's content (or settings) values, from the side panel. */
	async setValue(
		blockKey: string,
		data: BlockDataKind,
		alias: string,
		culture: string | null,
		value: unknown,
		activeCulture: string | null,
	) {
		const workspace = this.#workspace;
		const located = workspace && locateBlock(workspace.getValues() ?? [], blockKey, activeCulture);
		if (!located) return;
		const key = data === 'settingsData' ? located.settings?.key : located.content.key;
		if (!key) return;
		const next = withBlockPropertyValue(located.property.value, key, alias, culture, value, data);
		if (next !== located.property.value) await this.#set(located.property, next);
	}

	async #set(property: PropertyValueModel, value: unknown) {
		await this.#workspace?.setPropertyValue(
			property.alias,
			value,
			new UmbVariantId(property.culture, property.segment),
		);
	}

	async #canWrite(property: PropertyValueModel, activeCulture: string | null) {
		const workspace = this.#workspace;
		if (!workspace) return false;
		const holder = await workspace.structure.getPropertyStructureByAlias(property.alias);
		if (!holder) return false;
		const variant = new UmbVariantId(property.culture, property.segment);
		if (workspace.readOnlyGuard.getIsPermittedForVariant(variant)) return false;
		return workspace.propertyWriteGuard.getIsPermittedForVariantAndProperty(
			variant,
			holder,
			new UmbVariantId(activeCulture, null),
		);
	}
}
