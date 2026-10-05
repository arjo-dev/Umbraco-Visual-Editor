import { css, customElement, html, keyed, nothing, property, repeat, state } from '@umbraco-cms/backoffice/external/lit';
import type { PropertyValues } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import {
	UmbDocumentTypeDetailRepository,
	type UmbDocumentTypeDetailModel,
} from '@umbraco-cms/backoffice/document-type';
import type { UmbPropertyDatasetElement, UmbPropertyValueData } from '@umbraco-cms/backoffice/property';
import { ArjoBlockEditController } from './block-edit.controller.js';
import { pageSettings } from './page-settings.js';
import { locateBlock, type BlockData, type BlockDataKind, type LocatedBlock } from './property-values.js';

/** Element types, by key: shared by every block editor, as blocks of one type come up again and again. */
const elementTypes = new Map<string, Promise<UmbDocumentTypeDetailModel | undefined>>();

/**
 * Edits a block's content and settings in the side panel (#25), with the CMS's own property editors: each property of
 * the block's element type, grouped by its tabs and groups, in an `umb-property-dataset` holding the block's values.
 * Changes are written into the block, wherever it is in the document (ArjoBlockEditController).
 */
@customElement('arjo-visual-editor-block-editor')
export class ArjoVisualEditorBlockEditorElement extends UmbLitElement {
	/** The block's content key. */
	@property() blockKey?: string;
	/** The culture being edited: culture-variant block properties show that culture's value. */
	@property({ attribute: false }) culture: string | null = null;
	/** The tab to show; the canvas toolbar's settings button asks for 'settings'. */
	@property() tab: 'content' | 'settings' = 'content';

	@state() private _block?: LocatedBlock | null;
	@state() private _contentType?: UmbDocumentTypeDetailModel;
	@state() private _settingsType?: UmbDocumentTypeDetailModel;
	@state() private _tab: 'content' | 'settings' = 'content';
	@state() private _canEdit = false;

	#edit = new ArjoBlockEditController(this);
	#workspace?: typeof UMB_DOCUMENT_WORKSPACE_CONTEXT.TYPE;
	#repository = new UmbDocumentTypeDetailRepository(this);

	constructor() {
		super();
		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
			this.#workspace = workspace;
			if (workspace) this.observe(workspace.values, () => this.#locate(), 'arjoBlockValues');
		});
	}

	protected override willUpdate(changed: PropertyValues<this>) {
		if (changed.has('tab')) this._tab = this.tab;
		if (changed.has('blockKey') || changed.has('culture')) {
			this._contentType = this._settingsType = undefined;
			this.#locate();
			if (this.blockKey) void this.#edit.canEdit(this.blockKey, this.culture).then((can) => (this._canEdit = can));
		}
	}

	#locate() {
		if (!this.blockKey || !this.#workspace) return;
		this._block = locateBlock(this.#workspace.getValues() ?? [], this.blockKey, this.culture);
		void this.#loadType(this._block?.content, (type) => (this._contentType = type));
		void this.#loadType(this._block?.settings ?? undefined, (type) => (this._settingsType = type));
	}

	async #loadType(data: BlockData | undefined, set: (type: UmbDocumentTypeDetailModel | undefined) => void) {
		if (!data) return set(undefined);
		let type = elementTypes.get(data.contentTypeKey);
		if (!type) {
			type = this.#repository.requestByUnique(data.contentTypeKey).then(({ data }) => data);
			elementTypes.set(data.contentTypeKey, type);
		}
		const loaded = await type;
		if (!loaded) elementTypes.delete(data.contentTypeKey); // try again next time
		set(loaded);
	}

	/** The culture a property's value is stored under. */
	#cultureOf(type: UmbDocumentTypeDetailModel, alias: string) {
		return type.properties.find((p) => p.alias === alias)?.variesByCulture ? this.culture : null;
	}

	#onChange(event: Event, data: BlockDataKind, entry: BlockData, type: UmbDocumentTypeDetailModel) {
		const values = (event.target as UmbPropertyDatasetElement).value;
		for (const { alias, value } of values) {
			const culture = this.#cultureOf(type, alias);
			const current = entry.values.find((v) => v.alias === alias && (v.culture ?? null) === culture)?.value;
			if (value !== current && this.blockKey) {
				void this.#edit.setValue(this.blockKey, data, alias, culture, value, this.culture);
			}
		}
	}

	#renderProperties(
		data: BlockDataKind,
		entry: BlockData | null | undefined,
		type: UmbDocumentTypeDetailModel | undefined,
	) {
		if (!entry) return html`<p class="hint">${this.localize.term('arjoVisualEditor_noSettings')}</p>`;
		if (!type) return html`<uui-loader-bar></uui-loader-bar>`;

		const byAlias = new Map(type.properties.map((p) => [p.alias, p]));
		const dataset: UmbPropertyValueData[] = type.properties.map((p) => ({
			alias: p.alias,
			value: entry.values.find((v) => v.alias === p.alias && (v.culture ?? null) === this.#cultureOf(type, p.alias))
				?.value,
		}));
		const tabs = pageSettings(type.containers, type.properties, new Set());
		if (!tabs.length) return html`<p class="hint">${this.localize.term('arjoVisualEditor_noProperties')}</p>`;

		return html`
			<umb-property-dataset .value=${dataset} @change=${(e: Event) => this.#onChange(e, data, entry, type)}>
				${repeat(
					tabs,
					(tab) => tab.name,
					(tab) => html`
						${tab.name ? html`<h4>${tab.name}</h4>` : nothing}
						${repeat(
							tab.groups,
							(group) => `${tab.name}/${group.name}`,
							(group) => html`
								${group.name ? html`<h5>${group.name}</h5>` : nothing}
								${repeat(
									group.aliases,
									(alias) => alias,
									(alias) =>
										html`<umb-property-type-based-property
											.property=${byAlias.get(alias)}
											?readonly=${!this._canEdit}
										></umb-property-type-based-property>`,
								)}
							`,
						)}
					`,
				)}
			</umb-property-dataset>
		`;
	}

	override render() {
		if (this._block === undefined) return nothing;
		if (this._block === null) return html`<p class="hint">${this.localize.term('arjoVisualEditor_blockGone')}</p>`;
		const hasSettings = !!this._block.settings;
		const tab = hasSettings ? this._tab : 'content';
		return html`
			${
				hasSettings
					? html`<uui-tab-group>
							<uui-tab
								label=${this.localize.term('arjoVisualEditor_content')}
								?active=${tab === 'content'}
								@click=${() => (this._tab = 'content')}
							></uui-tab>
							<uui-tab
								label=${this.localize.term('arjoVisualEditor_settings')}
								?active=${tab === 'settings'}
								@click=${() => (this._tab = 'settings')}
							></uui-tab>
						</uui-tab-group>`
					: nothing
			}
			${keyed(
				// New editors for the other tab: reused, one with the same alias would be given the other type's value.
				tab,
				tab === 'settings'
					? this.#renderProperties('settingsData', this._block.settings, this._settingsType)
					: this.#renderProperties('contentData', this._block.content, this._contentType),
			)}
		`;
	}

	static override styles = css`
		:host {
			display: flex;
			flex-direction: column;
			gap: var(--uui-size-space-3);
		}

		uui-tab-group {
			flex: none;
			height: auto;
			border-bottom: 1px solid var(--uui-color-border);
		}

		h4,
		h5 {
			margin: var(--uui-size-space-3) 0 0;
		}

		h5 {
			color: var(--uui-color-text-alt);
		}

		.hint {
			margin: 0;
			color: var(--uui-color-text-alt);
		}
	`;
}

declare global {
	interface HTMLElementTagNameMap {
		'arjo-visual-editor-block-editor': ArjoVisualEditorBlockEditorElement;
	}
}
