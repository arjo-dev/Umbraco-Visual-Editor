import { css, customElement, html, nothing, state } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { UMB_PROPERTY_DATASET_CONTEXT } from '@umbraco-cms/backoffice/property';
import type { UmbElementValueModel } from '@umbraco-cms/backoffice/content';
import { postRenderSession } from '../api/index.js';
import { ARJO_VISUAL_MODE_CONTEXT, type ArjoVisualModeContext } from '../visual-mode/visual-mode.context.js';
import { viewInPath } from '../visual-mode/routes.js';
import {
	createHostChannel,
	createNonce,
	withNonce,
	type CanvasMessage,
	type HostChannel,
	type TargetRef,
} from '../protocol/index.js';

const RENDER_DEBOUNCE_MS = 300;

/**
 * Prototype visual mode (spikes #9-#11, protocol #12): a document workspace view that renders the document with its
 * *unsaved* workspace values in an iframe, re-rendering as they change. While it is showing, visual mode is active,
 * which hides the section sidebar/tree (docs/adr/0003-backoffice-integration.md). It talks to the canvas over the
 * protocol in ../protocol (docs/protocol.md). The real canvas host is #16.
 */
@customElement('arjo-visual-preview-workspace-view')
export class ArjoVisualPreviewWorkspaceViewElement extends UmbLitElement {
	@state() private _url?: string;
	@state() private _status: 'idle' | 'rendering' | 'error' = 'idle';
	@state() private _error?: string;
	@state() private _lastRenderMs?: number;
	@state() private _connected = false;
	@state() private _targetCount?: number;
	@state() private _selected: TargetRef | null = null;
	/** Never saved: there's no draft to render yet (render sessions overlay it, ADR 0001). */
	@state() private _isNew = false;

	#documentKey?: string;
	#culture: string | null = null;
	#values?: Array<UmbElementValueModel>;
	#variantNames: Array<{ culture: string | null; segment: string | null; name: string }> = [];
	#timer?: ReturnType<typeof setTimeout>;
	#requestId = 0;
	#restoreScrollY = 0;
	#visualMode?: ArjoVisualModeContext;
	readonly #nonce = createNonce();
	#channel?: HostChannel;
	/** The document URL this view was opened on, to tell "switched tab" from "left the document". */
	#documentBase?: string;

	constructor() {
		super();

		this.consumeContext(ARJO_VISUAL_MODE_CONTEXT, (context) => {
			// The consumer reports `undefined` as this element disconnects; keep the instance so we can still
			// switch visual mode off in disconnectedCallback.
			if (!context) return;
			this.#visualMode = context;
			if (this.isConnected) context.setActive(true);
		});

		this.consumeContext(UMB_PROPERTY_DATASET_CONTEXT, (dataset) => {
			this.#culture = dataset?.getVariantId().culture ?? null;
			this.#scheduleRender();
		});

		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
			if (!workspace) return;
			this.observe(workspace.isNew, (isNew) => {
				this._isNew = isNew === true;
				this.#scheduleRender();
			});
			this.observe(workspace.unique, (unique) => {
				this.#documentKey = unique ?? undefined;
				this.#scheduleRender();
			});
			this.observe(workspace.values, (values) => {
				this.#values = values;
				this.#scheduleRender();
			});
			// Names aren't property values; send them too so unsaved renames show.
			this.observe(workspace.variants, (variants) => {
				this.#variantNames = variants.map((v) => ({ culture: v.culture, segment: v.segment, name: v.name }));
				this.#scheduleRender();
			});
		});
	}

	override connectedCallback() {
		super.connectedCallback();
		this.#visualMode?.setActive(true);
		this.#documentBase = viewInPath(location.pathname)?.base;
	}

	override disconnectedCallback() {
		// Leaving the view (another tab, another document, another section) restores the normal backoffice.
		// Before super: that tears down this element's context consumers and controllers.
		this.#visualMode?.setActive(false);
		clearTimeout(this.#timer);
		this.#channel?.close();
		this.#channel = undefined;
		super.disconnectedCallback();
	}

	override updated() {
		// The iframe exists once the first render URL arrives; open the channel to it once.
		const iframe = this.#iframe;
		if (iframe && !this.#channel) {
			this.#channel = createHostChannel({
				iframe,
				nonce: this.#nonce,
				onMessage: (message) => this.#onCanvasMessage(message),
				onConnect: () => {
					this._connected = true;
					// A re-render is a fresh page: give it the current selection again.
					this.#channel?.send({ type: 'setSelection', target: this._selected });
				},
				onInvalid: (data) => console.warn('[Arjo.VisualEditor] ignored invalid canvas message', data),
			});
		}
	}

	#onCanvasMessage(message: CanvasMessage) {
		switch (message.type) {
			case 'ready':
				this._targetCount = message.targets.length;
				break;
			case 'select':
				this._selected = message.target;
				this.#channel?.send({ type: 'setSelection', target: message.target });
				break;
		}
	}

	#scheduleRender() {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.#render(), RENDER_DEBOUNCE_MS);
	}

	async #render() {
		if (this._isNew || !this.#documentKey || !this.#values) return;

		const requestId = ++this.#requestId;
		const started = performance.now();
		this._status = 'rendering';

		const { data, response } = await postRenderSession({
			body: {
				documentKey: this.#documentKey,
				culture: this.#culture,
				segment: null,
				values: this.#values.map((v) => ({ alias: v.alias, culture: v.culture, segment: v.segment, value: v.value })),
				variants: this.#variantNames,
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
		this._url = withNonce(data.url, this.#nonce);
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

	#describe(target: TargetRef) {
		const owner = target.ownerIsBlock ? `block ${target.ownerKey.slice(0, 8)}` : 'page';
		return target.kind === 'Block'
			? owner
			: `${owner} → ${target.alias}${target.culture ? ` (${target.culture})` : ''}`;
	}

	override render() {
		return html`
			<div class="bar">
				<uui-button
					look="outline"
					compact
					label="Standard editor"
					href=${this.#documentBase ? `${this.#documentBase}/view/content` : nothing}
				>
					<uui-icon name="icon-arrow-left"></uui-icon> Standard editor
				</uui-button>
				<uui-tag look="secondary">Visual editor prototype · unsaved values</uui-tag>
				${this.#culture ? html`<uui-tag look="outline">${this.#culture}</uui-tag>` : nothing}
				${this._status === 'rendering' ? html`<uui-loader-circle></uui-loader-circle>` : nothing}
				${this._lastRenderMs !== undefined ? html`<small>session ${this._lastRenderMs} ms</small>` : nothing}
				<small
					>${this._connected ? `canvas connected · ${this._targetCount ?? 0} targets` : 'canvas not connected'}</small
				>
				${this._selected ? html`<uui-tag look="primary">Selected: ${this.#describe(this._selected)}</uui-tag>` : nothing}
				${this._url ? html`<a href=${this._url} target="_blank" rel="noopener">Open in new tab</a>` : nothing}
			</div>
			${
				this._isNew
					? html`<uui-box class="notice"><p>You must first save your page to use the visual editor.</p></uui-box>`
					: nothing
			}
			${this._status === 'error' ? html`<uui-box><p class="error">${this._error}</p></uui-box>` : nothing}
			${this._url && !this._isNew ? html`<iframe src=${this._url} title="Visual preview" @load=${this.#onLoad}></iframe>` : nothing}
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
			flex-wrap: wrap;
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

		.notice p {
			margin: 0;
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
