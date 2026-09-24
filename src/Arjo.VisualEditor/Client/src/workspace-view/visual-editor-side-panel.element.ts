import { css, customElement, html, nothing, property, state } from '@umbraco-cms/backoffice/external/lit';
import type { PropertyValues } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { sameTarget, type TargetRef } from '../protocol/index.js';
import type { VisualEditorError } from './validation.controller.js';
import type { RichTextSession } from './inline-edit.controller.js';
import './visual-editor-property-editor.element.js';
import './visual-editor-block-editor.element.js';
import './visual-editor-page-settings.element.js';

/**
 * Visual editor side panel, with two views:
 * - **Selection:** edits what is selected on the canvas. A document property gets the CMS's own property editor
 *   (#19); a block, or a property inside one, gets the block's content and settings (#25).
 * - **Page settings:** the properties the page doesn't show (#22).
 * Selecting something on the canvas switches to Selection. Validation errors (#23) are listed above both views while
 * there are any; clicking one fires `show-error` (the workspace view selects it on the page).
 *
 * While rich text is edited on the canvas (#57), a note takes the place of its property editor; the toolbar is on the
 * page, above the text.
 *
 * @fires show-error - detail: the VisualEditorError clicked.
 */
@customElement('arjo-visual-editor-side-panel')
export class ArjoVisualEditorSidePanelElement extends UmbLitElement {
	@property({ attribute: false }) selected: TargetRef | null = null;
	/** Aliases of the document properties shown on the page; undefined until the canvas has connected. */
	@property({ attribute: false }) visibleAliases?: ReadonlySet<string>;

	/** Validation errors for the variant being edited. */
	@property({ attribute: false }) errors: VisualEditorError[] = [];
	/** Targets on the page (from the canvas), for error labels and whether an error can be shown on the page. */
	@property({ attribute: false }) targets: TargetRef[] = [];
	/** The culture being edited (block properties that vary by culture show its values). */
	@property({ attribute: false }) culture: string | null = null;
	/** The selected block's tab: content, or settings (the canvas block toolbar's settings button). */
	@property() blockTab: 'content' | 'settings' = 'content';
	/** Rich text being edited on the canvas, with the element its editor mounts on. */
	@property({ attribute: false }) richText?: RichTextSession & { mount: HTMLElement };

	@state() private _view: 'selection' | 'settings' = 'selection';

	/** Switches to Page settings, e.g. to show an error on a property that isn't on the page. */
	showPageSettings() {
		this._view = 'settings';
	}

	/** The page target an error points at, if it's on the page. */
	targetOnPage(ref: TargetRef | null) {
		return ref ? (this.targets.find((t) => sameTarget(t, ref)) ?? null) : null;
	}

	#errorLabel(error: VisualEditorError) {
		if (!error.target) return this.localize.term('general_name');
		const onPage = this.targetOnPage(error.target);
		const name = onPage?.label ?? error.propertyName ?? error.target.alias ?? 'Block';
		const owner = onPage?.ownerLabel;
		return owner ? `${name} (${owner})` : name;
	}

	#renderErrors() {
		if (!this.errors.length) return nothing;
		return html`
			<uui-box class="errors">
				<div slot="headline" class="errors-headline">
					<uui-icon name="icon-alert"></uui-icon>
					${this.errors.length === 1 ? '1 thing needs attention' : `${this.errors.length} things need attention`}
				</div>
				<ul>
					${this.errors.map(
						(error) =>
							html`<li>
								<button
									type="button"
									@click=${() => this.dispatchEvent(new CustomEvent('show-error', { detail: error }))}
								>
									<strong>${this.#errorLabel(error)}</strong>
									<span>${this.localize.string(error.body)}</span>
								</button>
							</li>`,
					)}
				</ul>
			</uui-box>
		`;
	}

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

		if (this.richText && sameTarget(this.richText.target, target)) {
			// Not the property editor: a second editor on the same value would fight the one on the page.
			const { heading, detail } = this.#describe(target);
			return html`
				<p class="heading">${heading}</p>
				<p class="detail">${detail}</p>
				<p class="hint">
					Editing on the page, with the toolbar above the text. Esc cancels; click elsewhere on the page when you're
					done.
				</p>
			`;
		}

		if (target.kind === 'Property' && !target.ownerIsBlock && target.alias) {
			return html`<arjo-visual-editor-property-editor
				.alias=${target.alias}
				.contentHref=${this.contentHref}
			></arjo-visual-editor-property-editor>`;
		}

		// A block, or a property inside one: the block's content and settings.
		const { heading, detail } = this.#describe(target);
		const block =
			target.kind === 'Block' ? target : this.targets.find((t) => t.kind === 'Block' && t.ownerKey === target.ownerKey);
		return html`
			<p class="heading">${target.kind === 'Block' ? heading : (block?.label ?? target.ownerLabel ?? 'Block')}</p>
			<p class="detail">${target.kind === 'Block' ? detail : `Block · selected: ${heading}`}</p>
			<arjo-visual-editor-block-editor
				.blockKey=${target.ownerKey}
				.culture=${this.culture}
				.tab=${this.blockTab}
			></arjo-visual-editor-block-editor>
			${this.contentHref ? html`<a class="standard" href=${this.contentHref}>Show in standard editor</a>` : nothing}
		`;
	}

	override render() {
		return html`
			${this.#renderErrors()}
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

		.errors {
			--uui-box-header-padding: var(--uui-size-space-3) var(--uui-size-space-4);
			border: 1px solid var(--uui-color-danger);
		}

		.errors-headline {
			display: flex;
			gap: var(--uui-size-space-2);
			align-items: center;
			color: var(--uui-color-danger);
			font-weight: 700;
		}

		.errors ul {
			margin: 0;
			padding: 0;
			list-style: none;
		}

		.errors button {
			all: unset;
			box-sizing: border-box;
			display: flex;
			flex-direction: column;
			width: 100%;
			padding: var(--uui-size-space-2) 0;
			cursor: pointer;
		}

		.errors button:hover strong,
		.errors button:focus-visible strong {
			text-decoration: underline;
		}

		.errors button:focus-visible {
			outline: 2px solid var(--uui-color-focus);
		}

		.errors button span {
			color: var(--uui-color-text-alt);
		}

		/* The tab group is made for workspace headers and takes 100% of the height; here it's a row at the top. */
		uui-tab-group {
			flex: none;
			height: auto;
			border-bottom: 1px solid var(--uui-color-border);
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
