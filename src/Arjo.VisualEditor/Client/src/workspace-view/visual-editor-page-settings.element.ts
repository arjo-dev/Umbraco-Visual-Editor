import { css, customElement, html, nothing, property, repeat, state } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { pageSettings, type ContainerModel, type PageSettingsTab, type PropertyModel } from './page-settings.js';

/**
 * The side panel's Page settings view (#22): the document properties the page doesn't show (SEO and meta fields,
 * "hide from navigation", settings, or ones that are empty), grouped by the document type's tabs and groups. Each
 * uses the CMS's own editor, as in #19.
 */
@customElement('arjo-visual-editor-page-settings')
export class ArjoVisualEditorPageSettingsElement extends UmbLitElement {
	/** Aliases of the document properties the canvas found on the page; undefined until it has connected. */
	@property({ attribute: false }) visibleAliases?: ReadonlySet<string>;

	@state() private _containers: ContainerModel[] = [];
	@state() private _properties: PropertyModel[] = [];

	/**
	 * Properties listed since this view opened. They stay listed even once they show on the page (e.g. an empty field
	 * you've just typed into), so the field you're editing doesn't disappear.
	 */
	#listed = new Set<string>();

	constructor() {
		super();
		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
			if (!workspace) return;
			this.observe(
				workspace.structure.contentTypes,
				(types) => (this._containers = types.flatMap((t) => t.containers ?? [])),
				'arjoContainers',
			);
			this.observe(
				workspace.structure.contentTypeProperties,
				(properties) => (this._properties = properties),
				'arjoProperties',
			);
		});
	}

	#renderTab(tab: PageSettingsTab) {
		return html`
			${tab.name ? html`<h3>${tab.name}</h3>` : nothing}
			${repeat(
				tab.groups,
				(group) => `${tab.name}/${group.name}`,
				(group) => html`
					<uui-box headline=${group.name ?? ''}>
						${repeat(
							group.aliases,
							(alias) => alias,
							(alias) => html`<umb-content-workspace-property .alias=${alias}></umb-content-workspace-property>`,
						)}
					</uui-box>
				`,
			)}
		`;
	}

	override render() {
		if (!this.visibleAliases) return html`<uui-loader-bar></uui-loader-bar>`;
		const visible = new Set([...this.visibleAliases].filter((alias) => !this.#listed.has(alias)));
		const tabs = pageSettings(this._containers, this._properties, visible);
		for (const alias of tabs.flatMap((t) => t.groups.flatMap((g) => g.aliases))) this.#listed.add(alias);
		if (!tabs.length) return html`<p class="hint">${this.localize.term('arjoVisualEditor_allOnPage')}</p>`;
		return html`
			<p class="hint">${this.localize.term('arjoVisualEditor_notOnPageHint')}</p>
			${repeat(
				tabs,
				(tab) => tab.name,
				(tab) => this.#renderTab(tab),
			)}
		`;
	}

	static override styles = css`
		:host {
			display: flex;
			flex-direction: column;
			gap: var(--uui-size-space-4);
		}

		h3 {
			margin: var(--uui-size-space-3) 0 0;
			font-size: var(--uui-type-default-size);
		}

		.hint {
			margin: 0;
			color: var(--uui-color-text-alt);
		}
	`;
}

declare global {
	interface HTMLElementTagNameMap {
		'arjo-visual-editor-page-settings': ArjoVisualEditorPageSettingsElement;
	}
}
