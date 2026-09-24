import { css, customElement, html, nothing, property, state } from '@umbraco-cms/backoffice/external/lit';
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
 * it on the rich text's element *in the canvas frame*, so the site's CSS styles it. The toolbar and statusbar render
 * here, in the side panel.
 *
 * @fires change - the markup changed (detail: the new markup).
 * @fires cancel - Escape was pressed in the editor.
 */
@customElement('arjo-visual-editor-rich-text-editor')
export class ArjoVisualEditorRichTextEditorElement extends UmbLitElement {
	/** The element in the canvas frame to edit: its content is replaced by the editor. */
	@property({ attribute: false }) mount?: HTMLElement;
	@property({ attribute: false }) configuration?: UmbPropertyEditorConfigCollection;
	/** The stored markup (not the rendered page HTML: links, media and blocks are resolved there). */
	@property({ attribute: false }) markup = '';

	@state() private _editor?: Editor;
	@state() private _toolbar: ToolbarValue = [[[]]];
	@state() private _statusbar: StatusbarValue = [];

	#context = new UmbTiptapRteContext(this);
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

	override disconnectedCallback() {
		super.disconnectedCallback();
		this._editor?.view.dom.removeEventListener('keydown', this.#onKeyDown);
		this._editor?.destroy();
		this._editor = undefined;
	}

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
		if (!this._editor) return html`<uui-loader-bar></uui-loader-bar>`;
		return html`
			<p class="hint">Editing on the page. Esc cancels; click elsewhere on the page when you're done.</p>
			${
				this._toolbar.flat(2).length
					? html`<umb-tiptap-toolbar
							.toolbar=${this._toolbar}
							.editor=${this._editor}
							.configuration=${this.configuration}
						></umb-tiptap-toolbar>`
					: nothing
			}
			${
				this._statusbar.flat().length
					? html`<umb-tiptap-statusbar
							.statusbar=${this._statusbar}
							.editor=${this._editor}
							.configuration=${this.configuration}
						></umb-tiptap-statusbar>`
					: nothing
			}
		`;
	}

	static override styles = css`
		:host {
			display: flex;
			flex-direction: column;
			gap: var(--uui-size-space-3);
		}

		.hint {
			margin: 0;
			color: var(--uui-color-text-alt);
		}

		umb-tiptap-toolbar {
			--umb-tiptap-top: 0;
			border: 1px solid var(--uui-color-border);
			border-radius: var(--uui-border-radius);
		}
	`;
}

declare global {
	interface HTMLElementTagNameMap {
		'arjo-visual-editor-rich-text-editor': ArjoVisualEditorRichTextEditorElement;
	}
}
