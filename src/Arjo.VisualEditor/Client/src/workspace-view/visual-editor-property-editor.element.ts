import { css, customElement, html, nothing, property, state } from '@umbraco-cms/backoffice/external/lit';
import type { PropertyValues } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { encodeFolderName } from '@umbraco-cms/backoffice/router';

/**
 * Edits one document property in the side panel (#19) with the CMS's own editor for it: `umb-content-workspace-property`,
 * the element the Content tab uses. It is bound to the workspace's property dataset (the active variant), so it has the
 * document type's label, description, configuration, validation and permissions, and changes flow into the workspace
 * like any edit on the Content tab (then live re-render, #18, shows them).
 */
@customElement('arjo-visual-editor-property-editor')
export class ArjoVisualEditorPropertyEditorElement extends UmbLitElement {
	@property() alias?: string;
	/** Content tab URL of this document (`.../view/content`); the link goes to the tab holding the property. */
	@property() contentHref?: string;

	@state() private _exists?: boolean;
	@state() private _tabPath?: string;

	#workspace?: typeof UMB_DOCUMENT_WORKSPACE_CONTEXT.TYPE;

	constructor() {
		super();
		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
			this.#workspace = workspace;
			void this.#observeProperty();
		});
	}

	protected override willUpdate(changed: PropertyValues<this>) {
		if (changed.has('alias')) void this.#observeProperty();
	}

	async #observeProperty() {
		const structure = this.#workspace?.structure;
		const alias = this.alias;
		if (!structure || !alias) return;

		this.observe(
			await structure.propertyStructureByAlias(alias),
			(propertyType) => {
				if (alias !== this.alias) return;
				this._exists = !!propertyType;
				this.#observeTab(propertyType?.container?.id ?? null);
			},
			'arjoPropertyType',
		);
	}

	/** The Content tab the property is on: its group's tab, or none (the root) for a group outside tabs. */
	#observeTab(containerId: string | null) {
		const structure = this.#workspace?.structure;
		if (!structure || !containerId) {
			this._tabPath = undefined;
			return;
		}
		this.observe(
			structure.containerById(containerId),
			(container) => {
				if (container?.type === 'Tab') {
					this._tabPath = `tab/${encodeFolderName(container.name ?? '')}`;
				} else if (container?.parent) {
					this.observe(
						structure.containerById(container.parent.id),
						(tab) => (this._tabPath = tab?.name ? `tab/${encodeFolderName(tab.name)}` : undefined),
						'arjoPropertyTab',
					);
				} else {
					this._tabPath = undefined;
				}
			},
			'arjoPropertyContainer',
		);
	}

	override render() {
		if (!this.alias) return nothing;
		if (this._exists === false) {
			return html`<p class="hint">This field isn't on the document type any more.</p>`;
		}
		const href = this.contentHref ? `${this.contentHref}${this._tabPath ? `/${this._tabPath}` : ''}` : undefined;
		return html`
			<umb-content-workspace-property .alias=${this.alias}></umb-content-workspace-property>
			${href ? html`<a class="standard" href=${href}>Show in standard editor</a>` : nothing}
		`;
	}

	static override styles = css`
		:host {
			display: block;
		}

		.standard {
			display: inline-block;
			margin-top: var(--uui-size-space-3);
			color: var(--uui-color-interactive);
			font-size: var(--uui-type-small-size);
		}

		.standard:hover {
			color: var(--uui-color-interactive-emphasis);
		}

		.hint {
			margin: 0;
			color: var(--uui-color-text-alt);
		}
	`;
}

declare global {
	interface HTMLElementTagNameMap {
		'arjo-visual-editor-property-editor': ArjoVisualEditorPropertyEditorElement;
	}
}
