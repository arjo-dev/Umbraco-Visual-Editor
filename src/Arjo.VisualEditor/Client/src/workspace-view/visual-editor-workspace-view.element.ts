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
import { VISUAL_EDITOR_DEVICES, type VisualEditorDeviceAlias } from './devices.js';
import './visual-editor-toolbar.element.js';
import './visual-editor-side-panel.element.js';
import './visual-editor-canvas.element.js';

const RENDER_DEBOUNCE_MS = 300;
const PANEL_STORAGE_KEY = 'arjo.visualEditor.panelOpen';

/**
 * The Visual editor: a document workspace view (ADR 0003) laid out as toolbar, canvas and side panel (#14).
 * It renders the document with its *unsaved* workspace values (render sessions, ADR 0001), re-rendering as they
 * change, and talks to the canvas over the protocol (docs/protocol.md). While it is showing, visual mode is active,
 * which hides the section sidebar/tree. The document name, culture switcher and Save / Save & Publish are Umbraco's
 * own workspace header and footer.
 */
@customElement('arjo-visual-editor-workspace-view')
export class ArjoVisualEditorWorkspaceViewElement extends UmbLitElement {
	@state() private _url?: string;
	@state() private _status: 'idle' | 'rendering' | 'error' = 'idle';
	@state() private _error?: string;
	@state() private _targetCount?: number;
	@state() private _selected: TargetRef | null = null;
	/** Never saved: there's no draft to render yet (render sessions overlay it, ADR 0001). */
	@state() private _isNew = false;
	@state() private _device: VisualEditorDeviceAlias = 'desktop';
	@state() private _panelOpen = readPanelOpen();
	@state() private _scale = 1;

	#documentKey?: string;
	#culture: string | null = null;
	#values?: Array<UmbElementValueModel>;
	#variantNames: Array<{ culture: string | null; segment: string | null; name: string }> = [];
	#timer?: ReturnType<typeof setTimeout>;
	#requestId = 0;
	#visualMode?: ArjoVisualModeContext;
	readonly #nonce = createNonce();
	#channel?: HostChannel;
	/** The document URL this view was opened on; the "Standard editor" link goes to its Content tab. */
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

	/** The canvas has a new iframe (first render, or after a message replaced it): bind the channel to it. */
	#onFrameChanged(event: CustomEvent<HTMLIFrameElement>) {
		this.#channel?.close();
		this.#channel = createHostChannel({
			iframe: event.detail,
			nonce: this.#nonce,
			onMessage: (message) => this.#onCanvasMessage(message),
			onConnect: () => {
				// A re-render is a fresh page: give it the current state again.
				this.#channel?.send({ type: 'setSelection', target: this._selected });
				this.#channel?.send({ type: 'setDevice', width: this.#deviceWidth });
			},
			onInvalid: (data) => console.warn('[Arjo.VisualEditor] ignored invalid canvas message', data),
		});
	}

	get #deviceWidth() {
		return VISUAL_EDITOR_DEVICES.find((d) => d.alias === this._device)?.width ?? null;
	}

	#onCanvasMessage(message: CanvasMessage) {
		switch (message.type) {
			case 'ready':
				this._targetCount = message.targets.length;
				break;
			case 'select':
				this._selected = message.target;
				this.#channel?.send({ type: 'setSelection', target: message.target });
				if (message.target && !this._panelOpen) this.#setPanelOpen(true);
				break;
		}
	}

	#onDeviceChange(event: CustomEvent<VisualEditorDeviceAlias>) {
		this._device = event.detail;
		this.#channel?.send({ type: 'setDevice', width: this.#deviceWidth });
	}

	#setPanelOpen(open: boolean) {
		this._panelOpen = open;
		try {
			localStorage.setItem(PANEL_STORAGE_KEY, String(open));
		} catch {
			// A per-browser convenience only.
		}
	}

	#scheduleRender() {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.#render(), RENDER_DEBOUNCE_MS);
	}

	async #render() {
		if (this._isNew || !this.#documentKey || !this.#values) return;

		const requestId = ++this.#requestId;
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
					? 'You must first save your page to use the visual editor.'
					: `The page couldn't be rendered (${response?.status}).`;
			return;
		}

		this._url = withNonce(data.url, this.#nonce);
	}

	#renderCanvas() {
		if (this._isNew) {
			return html`<uui-box class="message"><p>You must first save your page to use the visual editor.</p></uui-box>`;
		}
		if (this._status === 'error') {
			return html`<uui-box class="message"><p class="error">${this._error}</p></uui-box>`;
		}
		return html`<arjo-visual-editor-canvas
			.url=${this._url}
			.deviceWidth=${this.#deviceWidth}
			@frame-changed=${this.#onFrameChanged}
			@page-loaded=${() => (this._status = 'idle')}
			@scale-changed=${(e: CustomEvent<number>) => (this._scale = e.detail)}
		></arjo-visual-editor-canvas>`;
	}

	override render() {
		return html`
			<arjo-visual-editor-toolbar
				.standardEditorHref=${this.#documentBase ? `${this.#documentBase}/view/content` : undefined}
				.device=${this._device}
				.panelOpen=${this._panelOpen}
				.rendering=${this._status === 'rendering'}
				.scale=${this._scale}
				@device-change=${this.#onDeviceChange}
				@toggle-panel=${() => this.#setPanelOpen(!this._panelOpen)}
			></arjo-visual-editor-toolbar>
			<div class="body">
				<div class="canvas">${this.#renderCanvas()}</div>
				${
					this._panelOpen
						? html`<arjo-visual-editor-side-panel
								.selected=${this._selected}
								.targetCount=${this._targetCount}
							></arjo-visual-editor-side-panel>`
						: nothing
				}
			</div>
		`;
	}

	static override styles = css`
		:host {
			display: flex;
			flex-direction: column;
			height: 100%;
			/* The workspace doesn't always give its views a fixed height; keep the canvas usable regardless. */
			min-height: 70vh;
			box-sizing: border-box;
		}

		.body {
			flex: 1;
			display: flex;
			min-height: 0;
		}

		.canvas {
			flex: 1;
			min-width: 0;
			display: flex;
			background: var(--uui-color-background);
		}

		arjo-visual-editor-canvas {
			flex: 1;
		}

		arjo-visual-editor-side-panel {
			width: 360px;
			flex: none;
		}

		.message {
			align-self: flex-start;
			margin: var(--uui-size-layout-1);
			max-width: 40rem;
		}

		.message p {
			margin: 0;
		}

		.error {
			color: var(--uui-color-danger);
		}
	`;
}

function readPanelOpen() {
	try {
		return localStorage.getItem(PANEL_STORAGE_KEY) !== 'false';
	} catch {
		return true;
	}
}

export default ArjoVisualEditorWorkspaceViewElement;

declare global {
	interface HTMLElementTagNameMap {
		'arjo-visual-editor-workspace-view': ArjoVisualEditorWorkspaceViewElement;
	}
}
