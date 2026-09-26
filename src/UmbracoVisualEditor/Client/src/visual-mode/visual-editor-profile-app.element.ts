import { css, customElement, html, nothing, state } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UMB_CURRENT_USER_CONTEXT } from '@umbraco-cms/backoffice/current-user';
import { getOpenDocumentsIn, setOpenDocumentsIn, type OpenDocumentsIn } from './open-in.js';

/**
 * The Visual editor's section of the current user's profile (#48): where their documents open. Takes effect the next
 * time a document is opened.
 */
@customElement('arjo-visual-editor-profile-app')
export class ArjoVisualEditorProfileAppElement extends UmbLitElement {
	@state() private _userKey?: string;
	@state() private _openIn: OpenDocumentsIn = 'standard';

	constructor() {
		super();
		this.consumeContext(UMB_CURRENT_USER_CONTEXT, (context) => {
			this.observe(
				context?.unique,
				(unique) => {
					this._userKey = unique ?? undefined;
					this._openIn = getOpenDocumentsIn(this._userKey);
				},
				'arjoCurrentUser',
			);
		});
	}

	#onChange(event: Event) {
		if (!this._userKey) return;
		this._openIn = (event.target as HTMLSelectElement).value === 'visual' ? 'visual' : 'standard';
		setOpenDocumentsIn(this._userKey, this._openIn);
	}

	override render() {
		if (!this._userKey) return nothing;
		const options = (['standard', 'visual'] as const).map((value) => ({
			value,
			name: this.localize.term(
				value === 'visual' ? 'arjoVisualEditor_openInVisual' : 'arjoVisualEditor_openInStandard',
			),
			selected: value === this._openIn,
		}));
		return html`
			<uui-box headline=${this.localize.term('arjoVisualEditor_tabName')}>
				<uui-label for="open-in">${this.localize.term('arjoVisualEditor_openDocumentsIn')}</uui-label>
				<uui-select
					id="open-in"
					label=${this.localize.term('arjoVisualEditor_openDocumentsIn')}
					.options=${options}
					@change=${this.#onChange}
				></uui-select>
				<p class="hint">${this.localize.term('arjoVisualEditor_openDocumentsInHint')}</p>
			</uui-box>
		`;
	}

	static override styles = css`
		uui-label {
			display: block;
			margin-bottom: var(--uui-size-space-2);
		}

		uui-select {
			width: 100%;
		}

		.hint {
			margin: var(--uui-size-space-3) 0 0;
			color: var(--uui-color-text-alt);
			font-size: var(--uui-type-small-size);
		}
	`;
}

export default ArjoVisualEditorProfileAppElement;

declare global {
	interface HTMLElementTagNameMap {
		'arjo-visual-editor-profile-app': ArjoVisualEditorProfileAppElement;
	}
}
