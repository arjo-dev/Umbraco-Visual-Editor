import { css, customElement, html, nothing, property, query, state } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { loadManifestApi } from '@umbraco-cms/backoffice/extension-api';
import { umbExtensionsRegistry } from '@umbraco-cms/backoffice/extension-registry';
import type { UmbPropertyEditorConfigCollection } from '@umbraco-cms/backoffice/property-editor';
import {
	Editor,
	Extension,
	resolveFocusPosition,
	UmbTiptapRteContext,
	type UmbTiptapExtensionApi,
} from '@umbraco-cms/backoffice/tiptap';
import { createFrameFocus } from './frame-focus.js';
import { placeToolbars, type Box } from './toolbar-position.js';

/** Always on, as in `umb-input-tiptap`. */
const ESSENTIALS = 'Umb.Tiptap.RichTextEssentials';
/**
 * RTE blocks need the block manager contexts of the property editor, and their node views are Lit elements, which
 * can't render in the canvas frame (ADR 0004). Values with blocks are edited in the side panel instead.
 */
const BLOCK_EXTENSION = 'Umb.Tiptap.Block';
const BLOCK_TOOLBAR_ITEM = 'Umb.Tiptap.Toolbar.BlockPicker';

type ToolbarValue = string[][][];
type StatusbarValue = string[][];

/**
 * Edits rich text in place on the canvas (#57, ADR 0004). It creates the same Tiptap editor as the Content tab's
 * `umb-input-tiptap` (the data type's configuration and `tiptapExtension`s, created here in the backoffice) and mounts
 * it on the rich text's element *in the canvas frame*, so the site's CSS styles it.
 *
 * The toolbar floats over the page just above the text (and the statusbar just below it). They're backoffice
 * elements, which can't render inside the frame, so this element is a layer laid over the canvas: it covers the
 * canvas area and positions them from the edited element's box in the frame, allowing for the canvas's scale.
 *
 * @fires change - the markup changed (detail: the new markup).
 * @fires cancel - Escape was pressed in the editor.
 */
@customElement('arjo-visual-editor-rich-text-editor')
export class ArjoVisualEditorRichTextEditorElement extends UmbLitElement {
	/** The element in the canvas frame to edit: its content is replaced by the editor. */
	@property({ attribute: false }) mount?: HTMLElement;
	/** The canvas iframe holding `mount`. */
	@property({ attribute: false }) frame?: HTMLIFrameElement;
	@property({ attribute: false }) configuration?: UmbPropertyEditorConfigCollection;
	/** The stored markup (not the rendered page HTML: links, media and blocks are resolved there). */
	@property({ attribute: false }) markup = '';
	/** The property is the same in every language (#30): said on the toolbar, as the Content tab says it. */
	@property({ type: Boolean }) shared = false;

	@state() private _editor?: Editor;
	@state() private _toolbar: ToolbarValue = [[[]]];
	@state() private _statusbar: StatusbarValue = [];

	@query('.toolbar') private _toolbarBox?: HTMLElement;
	@query('.statusbar') private _statusbarBox?: HTMLElement;

	#context = new UmbTiptapRteContext(this);
	#frame = 0;
	#last = '';
	#extensions: UmbTiptapExtensionApi[] = [];
	#onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		this.dispatchEvent(new CustomEvent('cancel'));
	};

	override async firstUpdated() {
		await this.#loadExtensions();
		if (this.isConnected) this.#createEditor();
	}

	override connectedCallback() {
		super.connectedCallback();
		this.#follow();
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		cancelAnimationFrame(this.#frame);
		this._editor?.view.dom.removeEventListener('keydown', this.#onKeyDown);
		this._editor?.destroy();
		this._editor = undefined;
	}

	/**
	 * Keeps the toolbar and statusbar on the edited element while the page scrolls, reflows or is scaled. One read of
	 * a few rects per animation frame, written only when something moved.
	 */
	#follow = () => {
		this.#frame = requestAnimationFrame(this.#follow);
		const frame = this.frame;
		const mount = this.mount;
		const toolbar = this._toolbarBox;
		if (!frame || !mount || !toolbar) return;

		const layer = this.getBoundingClientRect();
		const frameRect = frame.getBoundingClientRect();
		const scale = frame.offsetWidth ? frameRect.width / frame.offsetWidth : 1;
		const r = mount.getBoundingClientRect();
		const element: Box = {
			left: frameRect.left - layer.left + r.left * scale,
			top: frameRect.top - layer.top + r.top * scale,
			width: r.width * scale,
			height: r.height * scale,
		};
		const statusbar = this._statusbarBox;
		const placed = placeToolbars(
			element,
			{ width: layer.width, height: layer.height },
			{ width: toolbar.offsetWidth, height: toolbar.offsetHeight },
			statusbar ? { width: statusbar.offsetWidth, height: statusbar.offsetHeight } : null,
		);
		const key = JSON.stringify(placed);
		if (key === this.#last) return;
		this.#last = key;
		toolbar.style.transform = `translate(${placed.toolbar.left}px, ${placed.toolbar.top}px)`;
		toolbar.style.visibility = placed.visible ? 'visible' : 'hidden';
		if (statusbar && placed.statusbar) {
			statusbar.style.transform = `translate(${placed.statusbar.left}px, ${placed.statusbar.top}px)`;
			statusbar.style.visibility = placed.visible ? 'visible' : 'hidden';
		}
	};

	async #loadExtensions() {
		const enabled = (this.configuration?.getValueByAlias<string[]>('extensions') ?? []).filter(
			(alias) => alias !== BLOCK_EXTENSION,
		);
		const aliases = enabled.includes(ESSENTIALS) ? enabled : [ESSENTIALS, ...enabled];
		await new Promise<void>((resolve) => {
			this.observe(
				umbExtensionsRegistry.byTypeAndAliases('tiptapExtension', aliases),
				async (manifests) => {
					const loaded = await Promise.all(
						manifests.map(async (manifest) => {
							if (!manifest.api) return null;
							const Api = await loadManifestApi(manifest.api);
							if (!Api) return null;
							const api = new Api(this) as UmbTiptapExtensionApi;
							api.manifest = manifest;
							return api;
						}),
					);
					this.#extensions = loaded.filter((api): api is UmbTiptapExtensionApi => !!api);
					resolve();
				},
				'arjoTiptapExtensions',
			);
		});
	}

	#createEditor() {
		const mount = this.mount;
		if (!mount) return;

		const extensions = new Map<string, ReturnType<UmbTiptapExtensionApi['getTiptapExtensions']>[number]>();
		for (const api of this.#extensions) {
			for (const extension of api.getTiptapExtensions({ configuration: this.configuration }) ?? []) {
				if (!extensions.has(extension.name)) extensions.set(extension.name, extension);
			}
		}

		const withoutBlocks = (rows: ToolbarValue) =>
			rows.map((row) => row.map((group) => group.filter((alias) => alias !== BLOCK_TOOLBAR_ITEM)));
		this._toolbar = withoutBlocks(this.configuration?.getValueByAlias<ToolbarValue>('toolbar') ?? [[[]]]);
		this._statusbar = this.configuration?.getValueByAlias<StatusbarValue>('statusbar') ?? [];

		// The editor takes the element over; its content comes from the stored markup.
		mount.replaceChildren();
		const editor = new Editor({
			element: { mount },
			extensions: [...extensions.values(), createFrameFocus({ Extension, resolveFocusPosition })],
			content: this.markup,
			injectCSS: false,
			onBeforeCreate: ({ editor }) => this.#extensions.forEach((api) => api.setEditor(editor)),
			onUpdate: ({ editor, transaction }) => {
				if (!transaction.docChanged) return;
				this.dispatchEvent(new CustomEvent<string>('change', { detail: editor.getHTML() }));
			},
		});
		this.#context.setEditor(editor);
		editor.view.dom.addEventListener('keydown', this.#onKeyDown);
		editor.commands.focus('end');
		this._editor = editor;
	}

	override render() {
		if (!this._editor) return nothing;
		return html`
			<div class="toolbar" role="toolbar" aria-label="Formatting">
				${this.shared ? html`<p class="shared">Shared across languages</p>` : nothing}
				${
					this._toolbar.flat(2).length
						? html`<umb-tiptap-toolbar
								.toolbar=${this._toolbar}
								.editor=${this._editor}
								.configuration=${this.configuration}
							></umb-tiptap-toolbar>`
						: nothing
				}
			</div>
			${
				this._statusbar.flat().length
					? html`<div class="statusbar">
							<umb-tiptap-statusbar
								.statusbar=${this._statusbar}
								.editor=${this._editor}
								.configuration=${this.configuration}
							></umb-tiptap-statusbar>
						</div>`
					: nothing
			}
		`;
	}

	static override styles = css`
		/* A layer over the canvas area; only the bars take pointer events. */
		:host {
			position: absolute;
			inset: 0;
			overflow: hidden;
			pointer-events: none;
			z-index: 2;
		}

		.toolbar,
		.statusbar {
			position: absolute;
			top: 0;
			left: 0;
			visibility: hidden;
			max-width: 100%;
			box-sizing: border-box;
			pointer-events: auto;
			background: var(--uui-color-surface);
			border: 1px solid var(--uui-color-border);
			border-radius: var(--uui-border-radius);
			box-shadow: var(--uui-shadow-depth-3);
		}

		umb-tiptap-toolbar {
			--umb-tiptap-top: 0;
			display: block;
		}

		.shared {
			margin: 0;
			padding: var(--uui-size-space-1) var(--uui-size-space-3);
			border-bottom: 1px solid var(--uui-color-border);
			color: var(--uui-color-text-alt);
			font-size: var(--uui-type-small-size);
		}
	`;
}

declare global {
	interface HTMLElementTagNameMap {
		'arjo-visual-editor-rich-text-editor': ArjoVisualEditorRichTextEditorElement;
	}
}
