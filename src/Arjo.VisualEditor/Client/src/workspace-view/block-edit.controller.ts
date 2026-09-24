import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UmbDataTypeDetailRepository } from '@umbraco-cms/backoffice/data-type';
import { UmbDocumentTypeDetailRepository } from '@umbraco-cms/backoffice/document-type';
import { UMB_NOTIFICATION_CONTEXT } from '@umbraco-cms/backoffice/notification';
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
} from './block-operations.js';
import {
	locateBlock,
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
		const workspace = this.#workspace;
		if (!workspace) return null;
		let dataTypeKey: string | undefined;
		if (to.ownerKey === workspace.getUnique()) {
			dataTypeKey = (await workspace.structure.getPropertyStructureByAlias(to.propertyAlias))?.dataType.unique;
		} else {
			const owner = locateBlock(workspace.getValues() ?? [], to.ownerKey, activeCulture);
			if (!owner) return null;
			const { data: elementType } = await new UmbDocumentTypeDetailRepository(this).requestByUnique(
				owner.content.contentTypeKey,
			);
			dataTypeKey = elementType?.properties.find((p) => p.alias === to.propertyAlias)?.dataType.unique;
		}
		if (!dataTypeKey) return null;
		const { data } = await new UmbDataTypeDetailRepository(this).requestByUnique(dataTypeKey);
		return data?.values ?? null;
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
