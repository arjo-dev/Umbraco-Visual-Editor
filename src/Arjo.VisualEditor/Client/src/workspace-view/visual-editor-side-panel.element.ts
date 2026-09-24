import { css, customElement, html, nothing, property } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import type { TargetRef } from '../protocol/index.js';

/**
 * Visual editor side panel. For now it shows what is selected on the canvas; property editing (#19), page settings
 * (#22) and block editing (#25) will live here.
 */
@customElement('arjo-visual-editor-side-panel')
export class ArjoVisualEditorSidePanelElement extends UmbLitElement {
	@property({ attribute: false }) selected: TargetRef | null = null;
	/** Editable areas the canvas found, or undefined before it has connected. */
	@property({ attribute: false }) targetCount?: number;

	#describe(target: TargetRef) {
		const owner = target.ownerIsBlock ? `Block ${target.ownerKey.slice(0, 8)}` : 'Page';
		if (target.kind === 'Block') return { heading: owner, detail: 'Block' };
		return { heading: target.alias ?? '', detail: `${owner}${target.culture ? ` · ${target.culture}` : ''}` };
	}

	override render() {
		const selected = this.selected ? this.#describe(this.selected) : null;
		return html`
			<uui-box headline="Selection">
				${
					selected
						? html`
								<p class="heading">${selected.heading}</p>
								<p class="detail">${selected.detail}</p>
								<p class="hint">Editing selected content arrives in a later release.</p>
							`
						: html`<p class="hint">Click something on the page to select it.</p>`
				}
			</uui-box>
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
	`;
}

declare global {
	interface HTMLElementTagNameMap {
		'arjo-visual-editor-side-panel': ArjoVisualEditorSidePanelElement;
	}
}
