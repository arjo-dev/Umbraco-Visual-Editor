import { css, customElement, html, nothing, property, state } from '@umbraco-cms/backoffice/external/lit';
import type { PropertyValues } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { fitScale, type VisualEditorSize } from './devices.js';

/** Path prefix of render-session URLs (RenderSessionContentFinder.PathPrefix). */
const RENDER_PATH_PREFIX = '/__visual-editor/render/';

/**
 * The canvas host (#16): an iframe showing a render-session page (ADR 0001) at the chosen device width.
 *
 * - Same-origin URL, not `srcdoc`: relative asset URLs, cookies and scripts behave exactly as on the live site, and
 *   the host can keep the scroll position across re-renders.
 * - `sandbox` omits `allow-top-navigation`, so the site's scripts can't navigate the backoffice window. With
 *   `allow-scripts` + `allow-same-origin` it is not a security boundary (the page is the site's own code).
 * - Device sizes (width and height) that don't fit the available space are scaled down to fit both.
 * - If the frame ends up anywhere other than the render page (a script navigated it, a meta refresh), the render
 *   page is loaded again. The in-page runtime stops ordinary link clicks and form submits.
 * - A load without the edit-mode marker manifest means the template failed (an error page): shown as a warning
 *   with the page still visible for debugging.
 *
 * @fires frame-changed - a new iframe element is in place (detail: the iframe); bind the protocol channel to it.
 * @fires page-loaded - a render page finished loading (detail: whether it rendered normally, i.e. has markers).
 * @fires scale-changed - the zoom applied to fit the device width changed (detail: 0-1; 1 when not scaled).
 */
@customElement('arjo-visual-editor-canvas')
export class ArjoVisualEditorCanvasElement extends UmbLitElement {
	/** Render-session URL (with the protocol nonce fragment). */
	@property() url?: string;
	/** Device size in CSS pixels; null (or a size without dimensions) fills the available space. */
	@property({ attribute: false }) deviceSize: Pick<VisualEditorSize, 'width' | 'height'> | null = null;

	@state() private _loaded = false;
	@state() private _renderError = false;
	@state() private _scale = 1;

	#restoreScrollY = 0;
	#frame?: HTMLIFrameElement;
	#resizeObserver = new ResizeObserver(() => this.#updateScale());

	override connectedCallback() {
		super.connectedCallback();
		this.#resizeObserver.observe(this);
	}

	override disconnectedCallback() {
		this.#resizeObserver.disconnect();
		super.disconnectedCallback();
	}

	protected override willUpdate(changed: PropertyValues<this>) {
		// Remember where the reader was before the next render replaces the page.
		if (changed.has('url') && this.#frame) {
			this.#restoreScrollY = this.#frame.contentWindow?.scrollY ?? 0;
		}
	}

	protected override updated(changed: PropertyValues<this>) {
		// The error banner takes height too, so refit when it appears or goes.
		if (changed.has('deviceSize') || (changed as Map<PropertyKey, unknown>).has('_renderError')) this.#updateScale();
		const frame = this.shadowRoot?.querySelector('iframe') ?? undefined;
		if (frame !== this.#frame) {
			this.#frame = frame;
			if (frame) this.dispatchEvent(new CustomEvent<HTMLIFrameElement>('frame-changed', { detail: frame }));
		}
	}

	get frame() {
		return this.#frame;
	}

	#updateScale() {
		const banner = this.shadowRoot?.querySelector<HTMLElement>('.warning')?.offsetHeight ?? 0;
		const scale = this.deviceSize
			? fitScale(this.deviceSize, this.clientWidth - 2 * CANVAS_GUTTER, this.clientHeight - banner - 2 * CANVAS_GUTTER)
			: 1;
		if (scale === this._scale) return;
		this._scale = scale;
		this.dispatchEvent(new CustomEvent<number>('scale-changed', { detail: scale }));
	}

	#onLoad() {
		const frameWindow = this.#frame?.contentWindow;
		if (!frameWindow || !this.url) return;

		let path: string | undefined;
		try {
			path = frameWindow.location.pathname;
		} catch {
			// Cross-origin: something navigated the frame off the site.
		}
		if (!path?.startsWith(RENDER_PATH_PREFIX)) {
			// Navigated away from the render page: go back to it.
			frameWindow.location.replace(this.url);
			return;
		}

		this._loaded = true;
		this._renderError = !frameWindow.document.getElementById('uve-markers');
		frameWindow.scrollTo(0, this.#restoreScrollY);
		this.dispatchEvent(new CustomEvent<boolean>('page-loaded', { detail: !this._renderError }));
	}

	override render() {
		if (!this.url) return html`<uui-loader-bar></uui-loader-bar>`;

		const width = this.deviceSize?.width ?? null;
		const height = this.deviceSize?.height ?? null;
		const sized = width !== null && height !== null;
		const scaled = sized && this._scale < 1;
		return html`
			${!this._loaded ? html`<uui-loader-bar class="first-load"></uui-loader-bar>` : nothing}
			${
				this._renderError
					? html`<div class="warning" role="alert">
							<uui-icon name="icon-alert"></uui-icon>
							This page didn't render normally, so it can't be edited visually. The template may have thrown an error;
							details are shown below.
						</div>`
					: nothing
			}
			<div
				class="stage ${sized ? 'device' : 'full'}"
				style=${sized ? `width: ${width! * this._scale}px; height: ${height! * this._scale}px` : nothing}
			>
				<iframe
					src=${this.url}
					title="Page preview"
					sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
					style=${
						sized
							? `width: ${width}px; height: ${height}px; transform: scale(${this._scale}); transform-origin: 0 0`
							: nothing
					}
					class=${scaled ? 'scaled' : ''}
					@load=${this.#onLoad}
				></iframe>
			</div>
		`;
	}

	static override styles = css`
		:host {
			--arjo-canvas-gutter: 20px;
			position: relative;
			display: flex;
			flex-direction: column;
			align-items: center;
			min-width: 0;
			height: 100%;
			overflow: auto;
			background: var(--uui-color-background);
		}

		uui-loader-bar {
			width: 100%;
			flex: none;
		}

		.first-load {
			position: absolute;
			top: 0;
		}

		.warning {
			display: flex;
			gap: var(--uui-size-space-3);
			align-items: center;
			align-self: stretch;
			padding: var(--uui-size-space-3) var(--uui-size-space-4);
			background: var(--uui-color-warning);
			color: var(--uui-color-warning-contrast);
		}

		.stage {
			flex: 1;
			min-height: 0;
		}

		.stage.full {
			align-self: stretch;
		}

		.stage.device {
			margin: var(--arjo-canvas-gutter) 0;
			flex: none;
			box-sizing: content-box;
			overflow: hidden;
			border: 1px solid var(--uui-color-border);
			border-radius: var(--uui-border-radius);
			box-shadow: var(--uui-shadow-depth-2);
		}

		iframe {
			display: block;
			width: 100%;
			height: 100%;
			border: 0;
			background: white;
		}
	`;
}

/** Space around a device-width stage, in CSS pixels (kept in sync with --arjo-canvas-gutter). */
const CANVAS_GUTTER = 20;

declare global {
	interface HTMLElementTagNameMap {
		'arjo-visual-editor-canvas': ArjoVisualEditorCanvasElement;
	}
}
