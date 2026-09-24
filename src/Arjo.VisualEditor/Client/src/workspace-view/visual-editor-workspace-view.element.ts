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
import { deviceFor, sizeFor, type VisualEditorDeviceAlias } from './devices.js';
import { recallView, rememberView } from './view-memory.js';
import './visual-editor-toolbar.element.js';
import './visual-editor-side-panel.element.js';
import './visual-editor-canvas.element.js';

const RENDER_DEBOUNCE_MS = 300;
const PANEL_STORAGE_KEY = 'arjo.visualEditor.panelOpen';
/** Chosen device and per-device sizes are remembered for the browser session. */
const PREVIEW_STORAGE_KEY = 'arjo.visualEditor.preview';

/**
 * The Visual editor: a document workspace view (ADR 0003) laid out as toolbar, canvas and side panel (#14).
 * It renders the document with its *unsaved* workspace values (render sessions, ADR 0001), re-rendering as they
 * change, and talks to the canvas over the protocol (docs/protocol.md). While it is showing, visual mode is active,
 * which hides the section sidebar/tree. The document name, culture switcher and Save / Save & Publish are Umbraco's
 * own workspace header and footer.
 */
@customElement('arjo-visual-editor-workspace-view')
export class ArjoVisualEditorWorkspaceViewElement extends UmbLitElement {
	/** The frame's page; changing it reloads the frame. */
	@state() private _url?: string;
	/** The newest render, whether loaded or patched into the page (#18). */
	@state() private _latestUrl?: string;
	@state() private _status: 'idle' | 'rendering' | 'error' = 'idle';
	@state() private _error?: string;
	@state() private _targetCount?: number;
	@state() private _selected: TargetRef | null = null;
	/** Never saved: there's no draft to render yet (render sessions overlay it, ADR 0001). */
	@state() private _isNew = false;
	@state() private _device: VisualEditorDeviceAlias = readPreview().device;
	/** Last size chosen for each device, e.g. { desktop: 'macbook-pro-14' }. */
	@state() private _sizes: Partial<Record<VisualEditorDeviceAlias, string>> = readPreview().sizes;
	/** The user wants the content tree visible in visual mode (remembered by the visual mode context). */
	@state() private _treeVisible = false;
	@state() private _panelOpen = readPanelOpen();
	@state() private _scale = 1;
	/** Scroll position to open the page at, when coming back to a document. */
	@state() private _initialScrollY = 0;

	#documentKey?: string;
	#culture: string | null = null;
	#values?: Array<UmbElementValueModel>;
	#variantNames: Array<{ culture: string | null; segment: string | null; name: string }> = [];
	#timer?: ReturnType<typeof setTimeout>;
	#requestId = 0;
	#visualMode?: ArjoVisualModeContext;
	readonly #nonce = createNonce();
	#channel?: HostChannel;
	/** The frame shows a normal render with the canvas runtime, so newer renders can be patched in (#18). */
	#canPatch = false;
	/** Render URL sent to the canvas, awaiting its `rendered` answer. */
	#pendingRender?: string;
	/** The latest render request sent (JSON): unchanged values don't render again. */
	#requested?: string;
	/** The request behind the render on show, and its URL (without the nonce). */
	#shown?: { request: string; url: string };
	/** Whether this view has looked for what it was showing last time (view-memory.ts). */
	#recalled = false;
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
			this.observe(context.showTree, (show) => (this._treeVisible = show), 'arjoShowTree');
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
		// Switching to another view destroys this one; remember the page, selection and scroll for coming back.
		if (this.#documentKey && this.#shown) {
			rememberView(this.#documentKey, this.#culture, {
				...this.#shown,
				selected: this._selected,
				scrollY: this.shadowRoot?.querySelector('arjo-visual-editor-canvas')?.pageScrollY ?? 0,
			});
		}
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

	get #deviceSize() {
		return sizeFor(this._device, this._sizes[this._device]);
	}

	get #deviceWidth() {
		return this.#deviceSize.width;
	}

	#onCanvasMessage(message: CanvasMessage) {
		switch (message.type) {
			case 'ready':
				this._targetCount = message.targets.length;
				break;
			case 'rendered':
				if (message.url !== this.#pendingRender) break; // an older render; a newer one is on its way
				this.#pendingRender = undefined;
				if (message.ok) this._status = 'idle';
				// It couldn't be patched in (e.g. the template threw): load it properly, which shows the error.
				else this.#load(withNonce(message.url, this.#nonce));
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
		this.#savePreview();
	}

	#onSizeChange(event: CustomEvent<{ device: VisualEditorDeviceAlias; sizeId: string }>) {
		const { device, sizeId } = event.detail;
		this._sizes = { ...this._sizes, [device]: sizeId };
		this.#channel?.send({ type: 'setDevice', width: this.#deviceWidth });
		this.#savePreview();
	}

	#savePreview() {
		try {
			sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify({ device: this._device, sizes: this._sizes }));
		} catch {
			// A convenience only.
		}
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

		const body = {
			documentKey: this.#documentKey,
			culture: this.#culture,
			segment: null,
			values: this.#values.map((v) => ({ alias: v.alias, culture: v.culture, segment: v.segment, value: v.value })),
			variants: this.#variantNames,
		};
		const request = JSON.stringify(body);

		if (!this.#recalled) {
			this.#recalled = true;
			const last = recallView(this.#documentKey, this.#culture);
			if (last) {
				this._selected = last.selected;
				this._initialScrollY = last.scrollY;
				// Nothing changed while away: show the same render again, without rendering it again.
				if (last.reusable && last.request === request) {
					this.#requested = request;
					this.#shown = { request, url: last.url };
					this._latestUrl = withNonce(last.url, this.#nonce);
					this.#load(this._latestUrl);
					return;
				}
			}
		}
		// The workspace re-emitted the same values (e.g. after a save): nothing new to show.
		if (request === this.#requested) return;
		this.#requested = request;

		const requestId = ++this.#requestId;
		this._status = 'rendering';

		const { data, response } = await postRenderSession({ body });

		// A newer render started while this one was in flight.
		if (requestId !== this.#requestId) return;

		if (!data) {
			this._status = 'error';
			this.#requested = undefined; // try again on the next change
			this.#canPatch = false; // the canvas is replaced by the message
			this._error =
				response?.status === 404
					? 'You must first save your page to use the visual editor.'
					: `The page couldn't be rendered (${response?.status}).`;
			return;
		}

		this.#shown = { request, url: data.url };
		this._latestUrl = withNonce(data.url, this.#nonce);
		// Patch the newer render into the page rather than reloading it: scroll, focus and selection survive.
		if (this.#canPatch && this.#channel?.send({ type: 'render', url: data.url })) {
			this.#pendingRender = data.url;
			return;
		}
		this.#load(this._latestUrl);
	}

	/** Loads a page into the frame; renders can be patched in again once it has loaded. */
	#load(url: string) {
		this.#canPatch = false;
		this.#pendingRender = undefined;
		this._url = url;
	}

	#onPageLoaded(event: CustomEvent<boolean>) {
		this.#canPatch = event.detail;
		this._status = 'idle';
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
			.latestUrl=${this._latestUrl}
			.initialScrollY=${this._initialScrollY}
			.deviceSize=${this.#deviceSize}
			@frame-changed=${this.#onFrameChanged}
			@page-loaded=${this.#onPageLoaded}
			@scale-changed=${(e: CustomEvent<number>) => (this._scale = e.detail)}
		></arjo-visual-editor-canvas>`;
	}

	override render() {
		return html`
			<arjo-visual-editor-toolbar
				.standardEditorHref=${this.#documentBase ? `${this.#documentBase}/view/content` : undefined}
				.device=${this._device}
				.sizeId=${this._sizes[this._device]}
				.treeVisible=${this._treeVisible}
				.panelOpen=${this._panelOpen}
				.rendering=${this._status === 'rendering'}
				.scale=${this._scale}
				@device-change=${this.#onDeviceChange}
				@size-change=${this.#onSizeChange}
				@toggle-tree=${() => this.#visualMode?.setShowTree(!this._treeVisible)}
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

function readPreview(): { device: VisualEditorDeviceAlias; sizes: Partial<Record<VisualEditorDeviceAlias, string>> } {
	try {
		const stored = JSON.parse(sessionStorage.getItem(PREVIEW_STORAGE_KEY) ?? '{}');
		const device = deviceFor(stored?.device).alias; // unknown values fall back to desktop
		const sizes = typeof stored?.sizes === 'object' && stored.sizes !== null ? stored.sizes : {};
		return { device, sizes };
	} catch {
		return { device: 'desktop', sizes: {} };
	}
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
