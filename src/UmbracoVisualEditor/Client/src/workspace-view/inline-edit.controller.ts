import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UmbDataTypeDetailRepository, type UmbDataTypeDetailModel } from '@umbraco-cms/backoffice/data-type';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { UmbDocumentTypeDetailRepository } from '@umbraco-cms/backoffice/document-type';
import { UmbPropertyEditorConfigCollection } from '@umbraco-cms/backoffice/property-editor';
import { UmbVariantId } from '@umbraco-cms/backoffice/variant';
import { sameTarget, type HostMessage, type TargetRef } from '../protocol/index.js';
import { locateValue, showsValue, withBlockPropertyValue, type ValueLocation } from './property-values.js';

/** Property editors that can be edited in place, and whether they're multi-line (as canvas/inline-edit.ts). */
const INLINE_EDITORS: Record<string, boolean> = {
	'Umbraco.TextBox': false,
	'Umbraco.TextArea': true,
};
const RICH_TEXT_EDITOR = 'Umbraco.RichText';

/** Umbraco's TextBox limit when the data type doesn't set one. */
const TEXTBOX_DEFAULT_MAX_CHARS = 512;

/** A rich text value (`Umbraco.RichText`): the markup, and the blocks it references. */
interface RichTextValue {
	markup: string;
	blocks?: unknown;
}

const EMPTY_BLOCKS = { layout: {}, contentData: [], settingsData: [], expose: [] };

/** What the side panel needs to edit rich text in place (#57). */
export interface RichTextSession {
	target: TargetRef;
	/** It's the same in every language (an invariant property of a culture-variant document). */
	shared: boolean;
	markup: string;
	configuration: UmbPropertyEditorConfigCollection;
}

/**
 * The host side of editing on the canvas: plain text (#20) and rich text (#57). Decides whether an edit may start,
 * then writes the edits into the document workspace: a document property directly, a block property by replacing its
 * block editor property's value. Either way it is an ordinary workspace change: the side panel shows it, Save stores
 * it. While an edit is going on, the view holds back re-renders (`editing`).
 */
export class ArjoInlineEditController extends UmbControllerBase {
	#workspace?: typeof UMB_DOCUMENT_WORKSPACE_CONTEXT.TYPE;
	#send: (message: HostMessage) => void;
	#editing: { target: TargetRef; location: ValueLocation; richText: boolean } | null = null;
	/** Starting is asynchronous; only one start at a time. */
	#starting = false;

	constructor(host: UmbControllerHost, send: (message: HostMessage) => void) {
		super(host);
		this.#send = send;
		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => (this.#workspace = workspace));
	}

	/** Something is being edited on the canvas. */
	get editing() {
		return this.#editing !== null;
	}

	/** The rich text target being edited, if any. */
	get richTextTarget() {
		return this.#editing?.richText ? this.#editing.target : null;
	}

	/**
	 * Answers `beginInlineEdit` if `target` can be edited in place and returns true; returns false otherwise (then the
	 * side panel is the way to edit it).
	 */
	async start(
		target: TargetRef,
		text: string,
		activeCulture: string | null,
		activeSegment: string | null = null,
	): Promise<boolean> {
		const editable = await this.#editable(target, activeCulture, activeSegment, (value) => showsValue(text, value));
		const editorAlias = editable?.dataType.editorAlias;
		if (!editable || !editorAlias || !(editorAlias in INLINE_EDITORS)) return false;

		const configured = Number(editable.dataType.values.find((v) => v.alias === 'maxChars')?.value);
		const maxLength =
			configured > 0 ? configured : editorAlias === 'Umbraco.TextBox' ? TEXTBOX_DEFAULT_MAX_CHARS : null;

		this.#editing = { target, location: editable.location, richText: false };
		this.#send({ type: 'beginInlineEdit', target, maxLength, multiline: INLINE_EDITORS[editorAlias] });
		return true;
	}

	/**
	 * Starts editing rich text in place (#57): returns what the editor needs, or null when it can't be edited in place
	 * (then the side panel is the way). The caller answers the canvas with `richTextEditing` once the editor is up.
	 */
	async startRichText(
		target: TargetRef,
		activeCulture: string | null,
		activeSegment: string | null = null,
	): Promise<RichTextSession | null> {
		const editable = await this.#editable(target, activeCulture, activeSegment, (value) => {
			const markup = (value as RichTextValue | null | undefined)?.markup ?? '';
			// RTE blocks can't be edited on the canvas yet (ADR 0004): their node views don't work in the frame.
			return typeof markup === 'string' && !/<umb-rte-block/i.test(markup);
		});
		if (!editable || editable.dataType.editorAlias !== RICH_TEXT_EDITOR) return null;
		if (!editable.dataType.editorUiAlias?.includes('Tiptap')) return null;

		this.#editing = { target, location: editable.location, richText: true };
		return {
			target,
			// A document property that doesn't vary, in a document that does: the same in every language (#30).
			shared: !!activeCulture && !target.ownerIsBlock && !editable.location.property.culture,
			markup: (editable.location.value as RichTextValue | null | undefined)?.markup ?? '',
			configuration: new UmbPropertyEditorConfigCollection(editable.dataType.values),
		};
	}

	/** Writes the edited text into the workspace. */
	write(target: TargetRef, value: string) {
		const editing = this.#editing;
		if (editing && !editing.richText && sameTarget(editing.target, target)) void this.#setValue(editing, value);
	}

	/** Writes edited rich text markup into the workspace, keeping the value's blocks. */
	writeRichText(target: TargetRef, markup: string) {
		const editing = this.#editing;
		if (!editing?.richText || !sameTarget(editing.target, target)) return;
		const original = editing.location.value as RichTextValue | null | undefined;
		void this.#setValue(editing, { ...(original ?? { blocks: EMPTY_BLOCKS }), markup });
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

	/**
	 * Whether `target` can be edited on the canvas: its value is found and `accept`ed, the user may write it, and its
	 * data type. Null otherwise.
	 */
	async #editable(
		target: TargetRef,
		activeCulture: string | null,
		activeSegment: string | null,
		accept: (value: unknown) => boolean,
	): Promise<{ location: ValueLocation; dataType: UmbDataTypeDetailModel } | null> {
		const workspace = this.#workspace;
		if (!workspace || this.#editing || this.#starting || !target.alias) return null;
		this.#starting = true;
		try {
			const location = locateValue(workspace.getValues() ?? [], target, activeCulture);
			if (!location || !accept(location.value)) return null;

			const holder = await workspace.structure.getPropertyStructureByAlias(location.property.alias);
			if (!holder) return null;
			const holderVariant = new UmbVariantId(location.property.culture, location.property.segment);
			const datasetVariant = new UmbVariantId(activeCulture, null);
			if (workspace.readOnlyGuard.getIsPermittedForVariant(holderVariant)) return null;
			// Values here are the default segment's: with a segment shown, its own value is edited in the side panel.
			if (activeSegment && holder.variesBySegment) return null;
			if (!workspace.propertyWriteGuard.getIsPermittedForVariantAndProperty(holderVariant, holder, datasetVariant)) {
				return null;
			}

			// The property type: the document's own, or the block element type's.
			let dataTypeUnique = holder.dataType.unique;
			if (location.block) {
				const { data: elementType } = await new UmbDocumentTypeDetailRepository(this).requestByUnique(
					location.block.contentTypeKey,
				);
				const propertyType = elementType?.properties.find((p) => p.alias === target.alias);
				if (!propertyType) return null;
				dataTypeUnique = propertyType.dataType.unique;
			}
			const { data: dataType } = await new UmbDataTypeDetailRepository(this).requestByUnique(dataTypeUnique);
			return dataType && !this.#editing ? { location, dataType } : null;
		} finally {
			this.#starting = false;
		}
	}

	async #setValue({ target, location }: { target: TargetRef; location: ValueLocation }, value: unknown) {
		const workspace = this.#workspace;
		if (!workspace || !target.alias) return;
		const variant = new UmbVariantId(location.property.culture, location.property.segment);

		if (!location.block) {
			await workspace.setPropertyValue(location.property.alias, value, variant);
			return;
		}
		// A block property: replace the block editor property's value with a copy holding the new value.
		const current = workspace.getPropertyValue(location.property.alias, variant);
		const next = withBlockPropertyValue(current, location.block.key, target.alias, target.culture, value);
		if (next !== current) await workspace.setPropertyValue(location.property.alias, next, variant);
	}
}
