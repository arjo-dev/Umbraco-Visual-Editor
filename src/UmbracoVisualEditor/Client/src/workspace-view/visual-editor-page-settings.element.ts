import { css, customElement, html, nothing, property, repeat, state } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { pageSettings, type ContainerModel, type PageSettingsTab, type PropertyModel } from './page-settings.js';

/**
 * The side panel's Page settings view (#22): all of the document's properties, as on the Content tab, grouped by the
 * document type's tabs and groups: the ones on the page and the ones it doesn't show (SEO and meta fields, "hide from
 * navigation", settings). Each uses the CMS's own editor, as in #19.
 */
@customElement('arjo-visual-editor-page-settings')
export class ArjoVisualEditorPageSettingsElement extends UmbLitElement {
	/**
	 * The document property whose rich text is being edited on the page (#57), if any: a note takes the place of its
	 * editor, as in the Selection view, since a second editor on the same value would fight the one on the page.
	 */
	@property({ attribute: false }) editingOnPage: string | null = null;

	@state() private _containers?: ContainerModel[];
	@state() private _properties?: PropertyModel[];

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
							(alias) =>
								alias === this.editingOnPage
									? html`<p class="hint">${this.localize.term('arjoVisualEditor_richTextHint')}</p>`
									: html`<umb-content-workspace-property .alias=${alias}></umb-content-workspace-property>`,
						)}
					</uui-box>
				`,
			)}
		`;
	}

	override render() {
		if (!this._containers || !this._properties) return html`<uui-loader-bar></uui-loader-bar>`;
		const tabs = pageSettings(this._containers, this._properties);
		if (!tabs.length) return html`<p class="hint">${this.localize.term('arjoVisualEditor_pageHasNoProperties')}</p>`;
		return html`
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
