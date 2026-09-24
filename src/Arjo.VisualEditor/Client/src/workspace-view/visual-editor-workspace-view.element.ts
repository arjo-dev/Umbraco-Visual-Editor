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
	sameTarget,
	withNonce,
	type BlockAction,
	type BlockPosition,
	type CanvasMessage,
	type HostChannel,
	type TargetRef,
} from '../protocol/index.js';
import { deviceFor, sizeFor, type VisualEditorDeviceAlias } from './devices.js';
import { ArjoInlineEditController, type RichTextSession } from './inline-edit.controller.js';
import { clampPanelWidth, PANEL_DEFAULT_WIDTH } from './panel-width.js';
import { ArjoValidationController, type VisualEditorError } from './validation.controller.js';
import { ArjoBlockEditController } from './block-edit.controller.js';
import './visual-editor-block-picker.element.js';
import '../rich-text/visual-editor-rich-text-editor.element.js';
import type { ArjoVisualEditorSidePanelElement } from './visual-editor-side-panel.element.js';
import './visual-editor-toolbar.element.js';
import './visual-editor-side-panel.element.js';
import './visual-editor-canvas.element.js';

const RENDER_DEBOUNCE_MS = 300;
const PANEL_STORAGE_KEY = 'arjo.visualEditor.panelOpen';
const PANEL_WIDTH_STORAGE_KEY = 'arjo.visualEditor.panelWidth';
/** Arrow keys on the resize handle move it this far (Shift: further). */
const PANEL_KEY_STEP = 16;
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
	/** Document properties the canvas found on the page; the rest are listed under Page settings (#22). */
	@state() private _visibleAliases?: ReadonlySet<string>;
	/** Targets on the page, as the canvas last reported them. */
	@state() private _targets: TargetRef[] = [];
	/** Validation errors for the variant being edited (#23). */
	@state() private _errors: VisualEditorError[] = [];
	/** Which of the selected block's tabs the side panel shows (#25); the block toolbar's settings button picks 'settings'. */
	@state() private _blockTab: 'content' | 'settings' = 'content';
	/** Rich text being edited on the canvas (#57): its toolbar floats over the page, above the text. */
	@state() private _richText?: RichTextSession & { mount: HTMLElement };
	@state() private _selected: TargetRef | null = null;
	/** Never saved: there's no draft to render yet (render sessions overlay it, ADR 0001). */
	@state() private _isNew = false;
	@state() private _device: VisualEditorDeviceAlias = readPreview().device;
	/** Last size chosen for each device, e.g. { desktop: 'macbook-pro-14' }. */
	@state() private _sizes: Partial<Record<VisualEditorDeviceAlias, string>> = readPreview().sizes;
	/** The user wants the content tree visible in visual mode (remembered by the visual mode context). */
	@state() private _treeVisible = false;
	@state() private _panelOpen = readPanelOpen();
	@state() private _panelWidth = readPanelWidth();
	/** The panel edge is being dragged: the canvas stops taking pointer events so the drag isn't lost to the iframe. */
	@state() private _resizing = false;
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
	/** The canvas iframe, for laying the rich text toolbar over it. */
	#frame?: HTMLIFrameElement;
	/** Editing text in place on the canvas (#20). */
	#inline = new ArjoInlineEditController(this, (message) => this.#channel?.send(message));
	/** Block toolbar actions: move, duplicate, delete (#25). */
	#blocks = new ArjoBlockEditController(this);
	/** Validation messages, placed on the page (#23). */
	#validation = new ArjoValidationController(this, (errors) => this.#onErrors(errors));
	/** The frame shows a normal render with the canvas runtime, so newer renders can be patched in (#18). */
	#canPatch = false;
	/** Render URL sent to the canvas, awaiting its `rendered` answer. */
	#pendingRender?: string;
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
			this.#validation.setCulture(this.#culture);
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
		this.#endRichText(false);
		clearTimeout(this.#timer);
		this.#channel?.close();
		this.#channel = undefined;
		super.disconnectedCallback();
	}

	/** The canvas has a new iframe (first render, or after a message replaced it): bind the channel to it. */
	#onFrameChanged(event: CustomEvent<HTMLIFrameElement>) {
		this.#frame = event.detail;
		this.#channel?.close();
		this.#channel = createHostChannel({
			iframe: event.detail,
			nonce: this.#nonce,
			onMessage: (message) => this.#onCanvasMessage(message),
			onConnect: () => {
				// A re-render is a fresh page: give it the current state again.
				this.#inline.reset();
				this._richText = undefined;
				this.#channel?.send({ type: 'setSelection', target: this._selected });
				this.#channel?.send({ type: 'setDevice', width: this.#deviceWidth });
				this.#sendErrors();
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
				this._targets = message.targets;
				// A selection made before the page showed it (e.g. a block just duplicated) now gets its labels.
				if (this._selected)
					this._selected = message.targets.find((t) => sameTarget(t, this._selected)) ?? this._selected;
				this._visibleAliases = new Set(
					message.targets.filter((t) => !t.ownerIsBlock && t.alias).map((t) => t.alias as string),
				);
				break;
			case 'rendered':
				if (message.url !== this.#pendingRender) break; // an older render; a newer one is on its way
				this.#pendingRender = undefined;
				if (message.ok) this._status = 'idle';
				// It couldn't be patched in (e.g. the template threw): load it properly, which shows the error.
				else this.#load(withNonce(message.url, this.#nonce));
				break;
			case 'inlineEditStart':
				void this.#inline.start(message.target, message.text, this.#culture).then((started) => {
					// Not plain text shown as stored (or not editable): the side panel is the way to edit it.
					if (!started && !this._panelOpen) this.#setPanelOpen(true);
				});
				break;
			case 'richTextEditStart':
				void this.#startRichText(message.target, message.mountId);
				break;
			case 'inlineEdit':
				this.#inline.write(message.target, message.value);
				break;
			case 'inlineEditEnd':
				// Rich text: the canvas asks to finish (a click on the page outside the editor).
				if (this._richText && sameTarget(this._richText.target, message.target)) {
					this.#endRichText(message.cancelled);
					break;
				}
				this.#inline.end(message.target, message.cancelled);
				// Renders wait while text is edited in place; catch up now.
				this.#scheduleRender();
				break;
			case 'blockMove':
				// A block dropped on the canvas (#26); the re-render shows it in its new place, still selected.
				void this.#blocks.moveTo(message.blockKey, message.to, this.#culture);
				break;
			case 'blockInsertRequest':
				// A "+" on the canvas (#28): pick a block type, add it, select it.
				void this.#onInsert(message.at);
				break;
			case 'blockResize':
				// A grid block's column span dragged on the canvas (#27); the host snaps it to the allowed spans.
				void this.#blocks.resize(message.blockKey, message.columnSpan, this.#culture);
				break;
			case 'blockAction':
				void this.#onBlockAction(message.blockKey, message.action);
				break;
			case 'select':
				// Selecting something else on the page finishes editing rich text.
				if (this._richText && !sameTarget(this._richText.target, message.target)) this.#endRichText(false);
				this._selected = message.target;
				this._blockTab = 'content';
				this.#channel?.send({ type: 'setSelection', target: message.target });
				if (message.target && !this._panelOpen) this.#setPanelOpen(true);
				break;
		}
	}

	/** A block by key, with its labels when the page has shown it. */
	#blockRef(key: string): TargetRef {
		return (
			this._targets.find((t) => t.kind === 'Block' && t.ownerKey === key) ?? {
				kind: 'Block',
				ownerKey: key,
				ownerIsBlock: true,
				alias: null,
				culture: null,
			}
		);
	}

	/** Adds a block (#28): the new block is selected once the re-render shows it, with its editor in the side panel. */
	async #onInsert(at: BlockPosition) {
		const picker = this.shadowRoot?.querySelector('arjo-visual-editor-block-picker');
		if (!picker) return;
		const key = await this.#blocks.insert(at, this.#culture, (blocks, groups, clipboardFilter) =>
			picker.pick(blocks, groups, clipboardFilter),
		);
		if (!key) return;
		this._selected = this.#blockRef(key);
		this._blockTab = 'content';
		if (!this._panelOpen) this.#setPanelOpen(true);
		this.#channel?.send({ type: 'setSelection', target: this._selected });
	}

	/** A block toolbar button (#25): settings shows the block's settings; the rest change the document. */
	async #onBlockAction(blockKey: string, action: BlockAction) {
		const ref = (key: string) => this.#blockRef(key);
		if (action === 'settings') {
			this._selected = ref(blockKey);
			this._blockTab = 'settings';
			if (!this._panelOpen) this.#setPanelOpen(true);
			return;
		}
		if (action === 'copy') {
			// To the CMS clipboard (#29), for pasting here or in the standard editor.
			await this.#blocks.copy(blockKey, ref(blockKey).label ?? 'Block', this.#culture);
			return;
		}
		const selected = await this.#blocks.apply(blockKey, action, this.#culture);
		if (selected === undefined) return;
		this._selected = selected ? ref(selected) : null;
		this._blockTab = 'content';
		// A copy is on the page after the re-render; the canvas selects it then.
		this.#channel?.send({ type: 'setSelection', target: this._selected });
	}

	/** Starts editing rich text on the canvas (#57): the editor mounts on the element the canvas marked. */
	async #startRichText(target: TargetRef, mountId: string) {
		const session = await this.#inline.startRichText(target, this.#culture);
		const frameDoc = this.shadowRoot?.querySelector('arjo-visual-editor-canvas')?.frame?.contentDocument;
		const mount = frameDoc?.querySelector<HTMLElement>(`[data-uve-rte="${CSS.escape(mountId)}"]`);
		if (!session || !mount) {
			if (session) this.#inline.end(target, false);
			// Not editable in place (blocks in it, permissions, …): the side panel is the way to edit it.
			if (!this._panelOpen) this.#setPanelOpen(true);
			return;
		}
		this._selected = target;
		this._richText = { ...session, mount };
		this.#channel?.send({ type: 'richTextEditing', target, active: true });
	}

	/** Finishes editing rich text; the edits were written as they were made, a cancelled edit is put back. */
	#endRichText(cancelled: boolean) {
		const session = this._richText;
		if (!session) return;
		this._richText = undefined;
		this.#inline.end(session.target, cancelled);
		this.#channel?.send({ type: 'richTextEditing', target: session.target, active: false });
		// Render the stored markup through the template again (links, media, the markers).
		this.#scheduleRender();
	}

	#onErrors(errors: VisualEditorError[]) {
		const hadErrors = this._errors.length > 0;
		this._errors = errors;
		this.#sendErrors();
		// Messages appear when a save or publish is refused: take the editor to the first one.
		if (!hadErrors && errors.length) void this.#showError(errors[0]);
	}

	/** Marks the errors on the page: the property (or block) and the blocks around it. */
	#sendErrors() {
		this.#channel?.send({
			type: 'setErrors',
			errors: this._errors.flatMap((error) => {
				const message = this.localize.string(error.body);
				return [...error.blocks, ...(error.target ? [error.target] : [])].map((target) => ({ target, message }));
			}),
		});
	}

	/**
	 * Shows an error: selects it on the page (scrolled into view) when it's there, the innermost block around it when
	 * only that is, or the property under Page settings when it isn't on the page at all.
	 */
	async #showError(error: VisualEditorError) {
		this.#endRichText(false);
		if (!this._panelOpen) this.#setPanelOpen(true);
		await this.updateComplete;
		const panel = this.shadowRoot?.querySelector<ArjoVisualEditorSidePanelElement>('arjo-visual-editor-side-panel');
		const onPage =
			panel?.targetOnPage(error.target) ??
			[...error.blocks]
				.reverse()
				.map((block) => panel?.targetOnPage(block))
				.find(Boolean) ??
			null;
		if (onPage) {
			this._selected = onPage;
			this.#channel?.send({ type: 'setSelection', target: onPage, reveal: true });
		} else if (error.target && !error.target.ownerIsBlock) {
			panel?.showPageSettings();
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

	#setPanelWidth(width: number) {
		this._panelWidth = clampPanelWidth(width, this.getBoundingClientRect().width);
		try {
			localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(this._panelWidth));
		} catch {
			// A per-browser convenience only.
		}
	}

	#onResizeStart(event: PointerEvent) {
		if (event.button !== 0) return;
		event.preventDefault();
		const handle = event.currentTarget as HTMLElement;
		const startX = event.clientX;
		const startWidth = this._panelWidth;
		handle.setPointerCapture(event.pointerId);
		this._resizing = true;

		// The panel is on the right, so dragging left makes it wider.
		const onMove = (e: PointerEvent) => this.#setPanelWidth(startWidth + startX - e.clientX);
		const onEnd = () => {
			this._resizing = false;
			handle.removeEventListener('pointermove', onMove);
			handle.removeEventListener('pointerup', onEnd);
			handle.removeEventListener('pointercancel', onEnd);
		};
		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', onEnd);
		handle.addEventListener('pointercancel', onEnd);
	}

	#onResizeKey(event: KeyboardEvent) {
		const step = event.shiftKey ? PANEL_KEY_STEP * 4 : PANEL_KEY_STEP;
		if (event.key === 'ArrowLeft') this.#setPanelWidth(this._panelWidth + step);
		else if (event.key === 'ArrowRight') this.#setPanelWidth(this._panelWidth - step);
		else return;
		event.preventDefault();
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
		// The canvas shows the text as it's typed; re-rendering now would only fight it. Rendered when editing ends.
		if (this.#inline.editing) return;

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
			this.#canPatch = false; // the canvas is replaced by the message
			this._error =
				response?.status === 404
					? 'You must first save your page to use the visual editor.'
					: `The page couldn't be rendered (${response?.status}).`;
			return;
		}

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

	/** The rich text editor being used on the canvas: a layer over it with the toolbar above the text (#57). */
	#renderRichTextEditor() {
		const session = this._richText;
		if (!session || !this.#frame) return nothing;
		return html`<arjo-visual-editor-rich-text-editor
			.mount=${session.mount}
			.frame=${this.#frame}
			.markup=${session.markup}
			.configuration=${session.configuration}
			@change=${(e: CustomEvent<string>) => this.#inline.writeRichText(session.target, e.detail)}
			@cancel=${() => this.#endRichText(true)}
		></arjo-visual-editor-rich-text-editor>`;
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
			.deviceSize=${this.#deviceSize}
			@frame-changed=${this.#onFrameChanged}
			@page-loaded=${this.#onPageLoaded}
			@scale-changed=${(e: CustomEvent<number>) => (this._scale = e.detail)}
		></arjo-visual-editor-canvas>`;
	}

	override render() {
		return html`
			<arjo-visual-editor-block-picker></arjo-visual-editor-block-picker>
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
			<div class="body ${this._resizing ? 'resizing' : ''}">
				<div class="canvas">${this.#renderCanvas()}${this.#renderRichTextEditor()}</div>
				${
					this._panelOpen
						? html`<div
									class="resizer"
									role="separator"
									aria-orientation="vertical"
									aria-label="Resize side panel"
									aria-valuenow=${this._panelWidth}
									tabindex="0"
									title="Drag to resize; double-click to reset"
									@pointerdown=${this.#onResizeStart}
									@keydown=${this.#onResizeKey}
									@dblclick=${() => this.#setPanelWidth(PANEL_DEFAULT_WIDTH)}
								></div>
								<arjo-visual-editor-side-panel
									style="width: ${this._panelWidth}px"
									.selected=${this._selected}
									.targetCount=${this._targetCount}
									.visibleAliases=${this._visibleAliases}
									.errors=${this._errors}
									.targets=${this._targets}
									.richText=${this._richText}
									.culture=${this.#culture}
									.blockTab=${this._blockTab}
									@show-error=${(e: CustomEvent<VisualEditorError>) => this.#showError(e.detail)}
									.contentHref=${this.#documentBase ? `${this.#documentBase}/view/content` : undefined}
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
			/* The rich text toolbar layer is positioned over it. */
			position: relative;
			flex: 1;
			min-width: 0;
			display: flex;
			background: var(--uui-color-background);
		}

		arjo-visual-editor-canvas {
			flex: 1;
		}

		arjo-visual-editor-side-panel {
			flex: none;
			min-width: 0;
			/* A remembered width can be too wide for a smaller window: always leave the canvas room (CANVAS_MIN_WIDTH). */
			max-width: calc(100% - 320px);
		}

		/* The panel's left edge; wider than it looks so it's easy to grab. */
		.resizer {
			flex: none;
			width: 6px;
			margin: 0 -3px;
			position: relative;
			z-index: 1;
			cursor: col-resize;
			touch-action: none;
		}

		.resizer:hover,
		.resizer:focus-visible,
		.resizing .resizer {
			background: var(--uui-color-interactive-emphasis);
			outline: none;
		}

		.resizing,
		.resizing * {
			cursor: col-resize;
			user-select: none;
		}

		.resizing .canvas {
			pointer-events: none;
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

function readPanelWidth() {
	try {
		const stored = Number(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
		return stored > 0 ? stored : PANEL_DEFAULT_WIDTH;
	} catch {
		return PANEL_DEFAULT_WIDTH;
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
