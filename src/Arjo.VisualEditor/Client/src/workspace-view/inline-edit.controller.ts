import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UmbDataTypeDetailRepository } from '@umbraco-cms/backoffice/data-type';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { UmbDocumentTypeDetailRepository } from '@umbraco-cms/backoffice/document-type';
import { UmbVariantId } from '@umbraco-cms/backoffice/variant';
import { sameTarget, type HostMessage, type TargetRef } from '../protocol/index.js';
import { locateValue, showsValue, withBlockPropertyValue, type ValueLocation } from './property-values.js';

/** Property editors that can be edited in place, and whether they're multi-line (as canvas/inline-edit.ts). */
const INLINE_EDITORS: Record<string, boolean> = {
	'Umbraco.TextBox': false,
	'Umbraco.TextArea': true,
};

/** Umbraco's TextBox limit when the data type doesn't set one. */
const TEXTBOX_DEFAULT_MAX_CHARS = 512;

/**
 * The host side of inline editing (#20). Decides whether a canvas `inlineEditStart` may go ahead, then writes the
 * edited text into the document workspace: a document property directly, a block property by replacing its block
 * editor property's value. Either way it is an ordinary workspace change: the side panel shows it, Save stores it.
 */
export class ArjoInlineEditController extends UmbControllerBase {
	#workspace?: typeof UMB_DOCUMENT_WORKSPACE_CONTEXT.TYPE;
	#send: (message: HostMessage) => void;
	#editing: { target: TargetRef; location: ValueLocation } | null = null;

	constructor(host: UmbControllerHost, send: (message: HostMessage) => void) {
		super(host);
		this.#send = send;
		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => (this.#workspace = workspace));
	}

	/** Text is being edited in place. */
	get editing() {
		return this.#editing !== null;
	}

	/**
	 * Answers `beginInlineEdit` if `target` can be edited in place and returns true; returns false otherwise (then the
	 * side panel is the way to edit it).
	 */
	async start(target: TargetRef, text: string, activeCulture: string | null): Promise<boolean> {
		const workspace = this.#workspace;
		if (!workspace || this.#editing || !target.alias) return false;

		const location = locateValue(workspace.getValues() ?? [], target, activeCulture);
		// Only text shown exactly as stored: otherwise typing would edit something other than the value.
		if (!location || !showsValue(text, location.value)) return false;

		const holder = await workspace.structure.getPropertyStructureByAlias(location.property.alias);
		if (!holder) return false;
		const holderVariant = new UmbVariantId(location.property.culture, location.property.segment);
		const datasetVariant = new UmbVariantId(activeCulture, null);
		if (workspace.readOnlyGuard.getIsPermittedForVariant(holderVariant)) return false;
		if (!workspace.propertyWriteGuard.getIsPermittedForVariantAndProperty(holderVariant, holder, datasetVariant)) {
			return false;
		}

		// The property type: the document's own, or the block element type's.
		let dataTypeUnique = holder.dataType.unique;
		if (location.block) {
			const { data: elementType } = await new UmbDocumentTypeDetailRepository(this).requestByUnique(
				location.block.contentTypeKey,
			);
			const propertyType = elementType?.properties.find((p) => p.alias === target.alias);
			if (!propertyType) return false;
			dataTypeUnique = propertyType.dataType.unique;
		}
		const { data: dataType } = await new UmbDataTypeDetailRepository(this).requestByUnique(dataTypeUnique);
		const editorAlias = dataType?.editorAlias;
		if (!dataType || !editorAlias || !(editorAlias in INLINE_EDITORS)) return false;

		if (this.#editing) return false; // another edit started while this was loading
		const configured = Number(dataType.values.find((v) => v.alias === 'maxChars')?.value);
		const maxLength =
			configured > 0 ? configured : editorAlias === 'Umbraco.TextBox' ? TEXTBOX_DEFAULT_MAX_CHARS : null;

		this.#editing = { target, location };
		this.#send({ type: 'beginInlineEdit', target, maxLength, multiline: INLINE_EDITORS[editorAlias] });
		return true;
	}

	/** Writes the edited text into the workspace. */
	write(target: TargetRef, value: string) {
		if (this.#editing && sameTarget(this.#editing.target, target)) void this.#setValue(this.#editing, value);
	}

	/** Editing finished; a cancelled edit puts the value back as it was. */
	end(target: TargetRef, cancelled: boolean) {
		const editing = this.#editing;
		if (!editing || !sameTarget(editing.target, target)) return;
		this.#editing = null;
		if (cancelled) void this.#setValue(editing, editing.location.value);
	}

	/** A new page is in the frame: any edit in the old one is over (its text was already written). */
	reset() {
		this.#editing = null;
	}

	async #setValue({ target, location }: { target: TargetRef; location: ValueLocation }, value: unknown) {
		const workspace = this.#workspace;
		if (!workspace || !target.alias) return;
		const variant = new UmbVariantId(location.property.culture, location.property.segment);

		if (!location.block) {
			await workspace.setPropertyValue(location.property.alias, value, variant);
			return;
		}
		// A block property: replace the block editor property's value with a copy holding the new text.
		const current = workspace.getPropertyValue(location.property.alias, variant);
		const next = withBlockPropertyValue(current, location.block.key, target.alias, target.culture, value);
		if (next !== current) await workspace.setPropertyValue(location.property.alias, next, variant);
	}
}
