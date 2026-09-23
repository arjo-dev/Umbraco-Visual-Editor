import { css, customElement, html, nothing, state } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { UMB_PROPERTY_DATASET_CONTEXT } from '@umbraco-cms/backoffice/property';
import type { UmbElementValueModel } from '@umbraco-cms/backoffice/content';
import { postRenderSession } from '../api/index.js';

const RENDER_DEBOUNCE_MS = 300;

/**
 * Development harness for spike #9: renders the document with its *unsaved* workspace values in an iframe and
 * re-renders as they change. The real canvas (#16) and toggle (#13) replace this.
 */
@customElement('arjo-visual-preview-workspace-view')
export class ArjoVisualPreviewWorkspaceViewElement extends UmbLitElement {
	@state() private _url?: string;
	@state() private _status: 'idle' | 'rendering' | 'error' = 'idle';
	@state() private _error?: string;
	@state() private _lastRenderMs?: number;

	#documentKey?: string;
	#culture: string | null = null;
	#values?: Array<UmbElementValueModel>;
	#timer?: ReturnType<typeof setTimeout>;
	#requestId = 0;
	#restoreScrollY = 0;

	constructor() {
		super();

		this.consumeContext(UMB_PROPERTY_DATASET_CONTEXT, (dataset) => {
			this.#culture = dataset?.getVariantId().culture ?? null;
			this.#scheduleRender();
		});

		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
			if (!workspace) return;
			this.observe(workspace.unique, (unique) => {
				this.#documentKey = unique ?? undefined;
				this.#scheduleRender();
			});
			this.observe(workspace.values, (values) => {
				this.#values = values;
				this.#scheduleRender();
			});
		});
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		clearTimeout(this.#timer);
	}

	#scheduleRender() {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.#render(), RENDER_DEBOUNCE_MS);
	}

	async #render() {
		if (!this.#documentKey || !this.#values) return;

		const requestId = ++this.#requestId;
		const started = performance.now();
		this._status = 'rendering';

		const { data, response } = await postRenderSession({
			body: {
				documentKey: this.#documentKey,
				culture: this.#culture,
				segment: null,
				values: this.#values.map((v) => ({ alias: v.alias, culture: v.culture, segment: v.segment, value: v.value })),
			},
		});

		// A newer render started while this one was in flight.
		if (requestId !== this.#requestId) return;

		if (!data) {
			this._status = 'error';
			this._error =
				response?.status === 404
					? 'Save the document once before previewing it.'
					: `Render failed (${response?.status}).`;
			return;
		}

		this.#restoreScrollY = this.#iframe?.contentWindow?.scrollY ?? 0;
		this._url = data.url;
		this._lastRenderMs = Math.round(performance.now() - started);
	}

	get #iframe() {
		return this.shadowRoot?.querySelector('iframe') ?? null;
	}

	#onLoad() {
		// Same-origin, so we can keep the reader's place across re-renders.
		this.#iframe?.contentWindow?.scrollTo(0, this.#restoreScrollY);
		this._status = 'idle';
	}

	override render() {
		return html`
			<div class="bar">
				<uui-tag look="secondary">Spike #9 preview · unsaved values</uui-tag>
				${this.#culture ? html`<uui-tag look="outline">${this.#culture}</uui-tag>` : nothing}
				${this._status === 'rendering' ? html`<uui-loader-circle></uui-loader-circle>` : nothing}
				${this._lastRenderMs !== undefined ? html`<small>session ${this._lastRenderMs} ms</small>` : nothing}
				${this._url ? html`<a href=${this._url} target="_blank" rel="noopener">Open in new tab</a>` : nothing}
			</div>
			${this._status === 'error' ? html`<uui-box><p class="error">${this._error}</p></uui-box>` : nothing}
			${this._url ? html`<iframe src=${this._url} title="Visual preview" @load=${this.#onLoad}></iframe>` : nothing}
		`;
	}

	static override styles = css`
		:host {
			display: flex;
			flex-direction: column;
			gap: var(--uui-size-space-3);
			height: 100%;
			padding: var(--uui-size-layout-1);
			box-sizing: border-box;
		}

		.bar {
			display: flex;
			align-items: center;
			gap: var(--uui-size-space-3);
		}

		.bar a {
			margin-left: auto;
		}

		iframe {
			flex: 1;
			min-height: 70vh;
			width: 100%;
			border: 1px solid var(--uui-color-border);
			border-radius: var(--uui-border-radius);
			background: white;
		}

		.error {
			color: var(--uui-color-danger);
			margin: 0;
		}
	`;
}

export default ArjoVisualPreviewWorkspaceViewElement;

declare global {
	interface HTMLElementTagNameMap {
		'arjo-visual-preview-workspace-view': ArjoVisualPreviewWorkspaceViewElement;
	}
}
