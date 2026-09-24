import { css, customElement, html, nothing, property, state } from '@umbraco-cms/backoffice/external/lit';
import type { PropertyValues } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import type { TargetRef } from '../protocol/index.js';
import './visual-editor-property-editor.element.js';
import './visual-editor-page-settings.element.js';

/**
 * Visual editor side panel, with two views:
 * - **Selection:** edits what is selected on the canvas. A document property gets the CMS's own property editor
 *   (#19); blocks and their properties arrive with block editing (#25).
 * - **Page settings:** the properties the page doesn't show (#22).
 * Selecting something on the canvas switches to Selection.
 */
@customElement('arjo-visual-editor-side-panel')
export class ArjoVisualEditorSidePanelElement extends UmbLitElement {
	@property({ attribute: false }) selected: TargetRef | null = null;
	/** Aliases of the document properties shown on the page; undefined until the canvas has connected. */
	@property({ attribute: false }) visibleAliases?: ReadonlySet<string>;

	@state() private _view: 'selection' | 'settings' = 'selection';

	protected override willUpdate(changed: PropertyValues<this>) {
		if (changed.has('selected') && this.selected) this._view = 'selection';
	}
	/** Editable areas the canvas found, or undefined before it has connected. */
	@property({ attribute: false }) targetCount?: number;
	/** Content tab URL of the document (`.../view/content`), for "Show in standard editor". */
	@property() contentHref?: string;

	#describe(target: TargetRef) {
		const culture = target.culture ? ` · ${target.culture}` : '';
		if (target.kind === 'Block') return { heading: target.label ?? 'Block', detail: `Block${culture}` };
		const owner = target.ownerIsBlock ? `In ${target.ownerLabel ?? 'a block'}` : 'Page';
		return { heading: target.label ?? target.alias ?? '', detail: `${owner}${culture}` };
	}

	#renderSelection() {
		const target = this.selected;
		if (!target) return html`<p class="hint">Click something on the page to select it.</p>`;

		if (target.kind === 'Property' && !target.ownerIsBlock && target.alias) {
			return html`<arjo-visual-editor-property-editor
				.alias=${target.alias}
				.contentHref=${this.contentHref}
			></arjo-visual-editor-property-editor>`;
		}

		const { heading, detail } = this.#describe(target);
		return html`
			<p class="heading">${heading}</p>
			<p class="detail">${detail}</p>
			<p class="hint">Editing blocks here arrives in a later release; use the standard editor for now.</p>
			${this.contentHref ? html`<a class="standard" href=${this.contentHref}>Show in standard editor</a>` : nothing}
		`;
	}

	override render() {
		return html`
			<uui-tab-group>
				<uui-tab
					label="Selection"
					?active=${this._view === 'selection'}
					@click=${() => (this._view = 'selection')}
				></uui-tab>
				<uui-tab
					label="Page settings"
					?active=${this._view === 'settings'}
					@click=${() => (this._view = 'settings')}
				></uui-tab>
			</uui-tab-group>
			${
				this._view === 'settings'
					? html`<arjo-visual-editor-page-settings
							.visibleAliases=${this.visibleAliases}
						></arjo-visual-editor-page-settings>`
					: html`<uui-box headline="Selection">${this.#renderSelection()}</uui-box>`
			}
			${
				this.targetCount !== undefined
					? html`<p class="status">${this.targetCount} editable areas on this page</p>`
					: nothing
			}
		`;
	}

	static override styles = css`
		:host {
			display: flex;
			flex-direction: column;
			gap: var(--uui-size-space-4);
			padding: var(--uui-size-space-4);
			box-sizing: border-box;
			background: var(--uui-color-surface);
			border-left: 1px solid var(--uui-color-border);
			color: var(--uui-color-text);
			overflow-y: auto;
		}

		p {
			margin: 0;
		}

		.heading {
			font-weight: 700;
		}

		.detail,
		.hint,
		.status {
			color: var(--uui-color-text-alt);
		}

		.hint {
			margin-top: var(--uui-size-space-3);
		}

		.status {
			font-size: var(--uui-type-small-size);
		}

		.standard {
			display: inline-block;
			margin-top: var(--uui-size-space-3);
			color: var(--uui-color-interactive);
			font-size: var(--uui-type-small-size);
		}
	`;
}

declare global {
	interface HTMLElementTagNameMap {
		'arjo-visual-editor-side-panel': ArjoVisualEditorSidePanelElement;
	}
}
