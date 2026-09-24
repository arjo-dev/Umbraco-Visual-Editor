import { customElement } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UMB_BLOCK_CATALOGUE_MODAL, UMB_BLOCK_MANAGER_CONTEXT } from '@umbraco-cms/backoffice/block';
import { umbOpenModal } from '@umbraco-cms/backoffice/modal';

/** A block type as the catalogue lists it (Block List and Block Grid configuration entries). */
export interface CatalogueBlockType {
	contentElementTypeKey: string;
	groupKey?: string | null;
}

/** A group of block types in the catalogue. */
export interface CatalogueBlockGroup {
	key: string;
	name: string;
}

/**
 * Opens the CMS block catalogue (#28) to pick the type of a block to add, from the Visual editor rather than from a
 * block property editor.
 *
 * The catalogue only shows its list when it finds a block manager context: in the Content tab, the Block List/Grid
 * property editor provides one. Modals take their contexts from the element that opened them, so this element opens it
 * and provides a stand-in manager to itself only. The catalogue only checks that one is there, and asks it for content
 * type details only when it offers to create the block in a workspace, which isn't asked for here.
 */
@customElement('arjo-visual-editor-block-picker')
export class ArjoVisualEditorBlockPickerElement extends UmbLitElement {
	constructor() {
		super();
		// Consumers of a context ask it for its host element; the rest is what the catalogue asks of a manager.
		const standIn = {
			getHostElement: () => this,
			getContentTypeHasProperties: () => false,
		} as unknown as typeof UMB_BLOCK_MANAGER_CONTEXT.TYPE;
		this.provideContext(UMB_BLOCK_MANAGER_CONTEXT, standIn);
	}

	/** The content element type key of the block type picked, or null when the catalogue was closed. */
	async pick(blocks: CatalogueBlockType[], blockGroups: CatalogueBlockGroup[] = []): Promise<string | null> {
		try {
			const value = await umbOpenModal(this, UMB_BLOCK_CATALOGUE_MODAL, {
				data: {
					blocks: blocks as typeof UMB_BLOCK_CATALOGUE_MODAL.DATA.blocks,
					blockGroups: blockGroups as typeof UMB_BLOCK_CATALOGUE_MODAL.DATA.blockGroups,
					openClipboard: false,
					// Pasting from the clipboard isn't done on the canvas yet: offer no clipboard entries.
					clipboardFilter: async () => false,
					createBlockInWorkspace: false,
					originData: { index: -1 } as typeof UMB_BLOCK_CATALOGUE_MODAL.DATA.originData,
				},
			});
			return value?.create?.contentElementTypeKey ?? null;
		} catch {
			return null; // closed
		}
	}

	override render() {
		return null;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'arjo-visual-editor-block-picker': ArjoVisualEditorBlockPickerElement;
	}
}
