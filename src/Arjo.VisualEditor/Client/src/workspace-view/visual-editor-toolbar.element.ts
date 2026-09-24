import { css, customElement, html, nothing, property } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { VISUAL_EDITOR_DEVICES, type VisualEditorDeviceAlias } from './devices.js';

/**
 * Visual editor top bar. The document name, culture switcher and Save / Save & Publish stay in Umbraco's own
 * workspace header and footer (ADR 0003); this bar holds the visual editor's own controls. Presentational: it
 * reflects state passed in and reports what the user asks for as events.
 *
 * @fires device-change - detail: the chosen device alias.
 * @fires toggle-panel - the side panel toggle was pressed.
 */
@customElement('arjo-visual-editor-toolbar')
export class ArjoVisualEditorToolbarElement extends UmbLitElement {
	/** Link back to the document's Content tab. */
	@property({ attribute: false }) standardEditorHref?: string;
	@property({ attribute: false }) device: VisualEditorDeviceAlias = 'desktop';
	@property({ type: Boolean }) panelOpen = true;
	@property({ type: Boolean }) rendering = false;

	#chooseDevice(alias: VisualEditorDeviceAlias) {
		this.dispatchEvent(new CustomEvent<VisualEditorDeviceAlias>('device-change', { detail: alias }));
	}

	override render() {
		return html`
			<div class="group">
				<uui-button look="secondary" compact label="Standard editor" href=${this.standardEditorHref ?? nothing}>
					<uui-icon name="icon-arrow-left"></uui-icon> Standard editor
				</uui-button>
			</div>

			<div class="group" role="group" aria-label="History">
				<!-- Undo/redo arrive with #33. -->
				<uui-button compact look="secondary" label="Undo" title="Undo (coming soon)" disabled>
					<uui-icon name="icon-undo"></uui-icon>
				</uui-button>
				<uui-button compact look="secondary" label="Redo" title="Redo (coming soon)" disabled>
					<uui-icon name="icon-redo"></uui-icon>
				</uui-button>
			</div>

			<uui-button-group class="devices" role="radiogroup" aria-label="Preview width">
				${VISUAL_EDITOR_DEVICES.map(
					(d) => html`
						<uui-button
							compact
							role="radio"
							aria-checked=${d.alias === this.device}
							look=${d.alias === this.device ? 'primary' : 'secondary'}
							label=${d.label}
							title=${d.label}
							@click=${() => this.#chooseDevice(d.alias)}
						>
							<uui-icon name=${d.icon}></uui-icon>
						</uui-button>
					`,
				)}
			</uui-button-group>

			<div class="group end">
				${this.rendering ? html`<uui-loader-circle aria-label="Updating preview"></uui-loader-circle>` : nothing}
				<uui-button
					compact
					look=${this.panelOpen ? 'primary' : 'secondary'}
					label=${this.panelOpen ? 'Hide side panel' : 'Show side panel'}
					title=${this.panelOpen ? 'Hide side panel' : 'Show side panel'}
					aria-pressed=${this.panelOpen}
					@click=${() => this.dispatchEvent(new CustomEvent('toggle-panel'))}
				>
					<uui-icon name="icon-panel-show"></uui-icon>
				</uui-button>
			</div>
		`;
	}

	static override styles = css`
		:host {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: var(--uui-size-space-4);
			padding: var(--uui-size-space-3) var(--uui-size-space-4);
			background: var(--uui-color-surface);
			border-bottom: 1px solid var(--uui-color-border);
			color: var(--uui-color-text);
		}

		.group {
			display: flex;
			align-items: center;
			gap: var(--uui-size-space-2);
		}

		.devices {
			margin: 0 auto;
		}

		.end {
			margin-left: auto;
		}

		uui-loader-circle {
			font-size: var(--uui-size-5);
		}
	`;
}

declare global {
	interface HTMLElementTagNameMap {
		'arjo-visual-editor-toolbar': ArjoVisualEditorToolbarElement;
	}
}
