import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { umbConfirmModal } from '@umbraco-cms/backoffice/modal';
import { UmbVariantId } from '@umbraco-cms/backoffice/variant';
import { duplicateBlock, isBlockEditorValue, moveBlock, removeBlock } from './block-operations.js';
import {
	locateBlock,
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
