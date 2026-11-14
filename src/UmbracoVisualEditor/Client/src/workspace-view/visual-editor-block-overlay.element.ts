import { css, customElement, html, keyed, nothing, property, state } from '@umbraco-cms/backoffice/external/lit';
import type { Observable } from '@umbraco-cms/backoffice/external/rxjs';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UMB_BLOCK_ENTRY_CONTEXT, UMB_BLOCK_MANAGER_CONTEXT } from '@umbraco-cms/backoffice/block';
import { UmbContextConsumer, type UmbContextMinimal, type UmbContextToken } from '@umbraco-cms/backoffice/context-api';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { UMB_MODAL_MANAGER_CONTEXT, type UmbModalContext } from '@umbraco-cms/backoffice/modal';
import { UMB_NOTIFICATION_CONTEXT } from '@umbraco-cms/backoffice/notification';
import { findBlockEntry } from './block-entry.js';
import { locateBlockHolder } from './property-values.js';
import './visual-editor-block-editor.element.js';

/** How long each wait may take: the hidden property editor to render the block, its types to load, its route. */
const WAIT_MS = 5000;
/**
 * How long the overlay may take to show once its route is in the URL. Umbraco's router takes a few seconds (about
 * 2.5 s on the Content tab of a local site, more here), so this is generous: giving up leaves a route without overlay.
 */
const SHOW_MS = 30000;
/** How often to look for the block's entry while the hidden property editor renders, and at the URL while it opens. */
const POLL_MS = 100;

/** Which of the block's views the overlay opens on. */
export type BlockOverlayView = 'content' | 'settings';

/** The block editor property that holds the block: on the document (`ownerKey` null), or on a parent block. */
interface Holder {
	ownerKey: string | null;
	alias: string;
}

/**
 * The request being handled, from the click until its overlay has fully closed:
 * - `preparing`: finding the block and its route; a newer request takes over;
 * - `navigated`: `edit()` went to the overlay's route, which Umbraco's router shows a few seconds later;
 * - `shown`: the overlay is open, or closing (Umbraco removes it a few seconds after its route left the URL; its
 *   backdrop covers the page until then, so clicks on the page don't get here).
 */
interface Request {
	blockKey: string;
	phase: 'preparing' | 'navigated' | 'shown';
}

/**
 * Overlay mode (VisualEditor:EditorMode Overlay, ADR 0005): opens Umbraco's own block overlay (the block workspace
 * modal, at the size set for the block type) for a block on the page, nested blocks included.
 *
 * The overlay is a routed modal registered by the block property editor that holds the block, and it gets its contexts
 * from that editor; closing the editor closes the overlay. So this element renders that one property editor, hidden,
 * and keeps it until the overlay closes:
 * - a block in a document property: the document's own property editor (`umb-content-workspace-property`);
 * - a nested block: the parent block's property holding it (`arjo-visual-editor-block-editor` with `onlyAlias`), which
 *   writes changes back into the document as the side panel does. So the nested block's overlay opens straight away.
 * It then finds the block's entry in it and calls `UMB_BLOCK_ENTRY_CONTEXT.edit()`, as clicking it on the Content tab
 * does. Like `arjo-visual-editor-block-picker`, it sits in the workspace view, so the overlay has the document's
 * workspace and variant.
 *
 * One overlay at a time, from the click until it has fully closed (see `Request`): the property editor can't be
 * swapped before then, as that would close the overlay, or (while closing) cut short Umbraco's revert on Close.
 *
 * @fires closed - the overlay it opened closed: the view takes focus back to the page.
 */
@customElement('arjo-visual-editor-block-overlay')
export class ArjoVisualEditorBlockOverlayElement extends UmbLitElement {
	/** The culture being edited: where blocks are looked up, and the values a nested holder shows. */
	@property({ attribute: false }) culture: string | null = null;

	/** The property editor rendered (hidden) for the block being opened or open. */
	@state() private _holder?: Holder;

	#workspace?: typeof UMB_DOCUMENT_WORKSPACE_CONTEXT.TYPE;
	#current?: Request;

	constructor() {
		super();
		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => (this.#workspace = workspace));
	}

	/**
	 * An overlay is being opened, is open or is still closing. The view ignores undo meanwhile: it would change the block
	 * under the overlay, which holds its own copy (and Close reverts to the one it started with).
	 */
	get busy() {
		return !!this.#current;
	}

	/**
	 * Opens the overlay of block `blockKey` on `view`. Resolves true once it shows; false when it doesn't: one is already
	 * on its way, open or closing, a newer request took over, the block has nothing to edit, it was cancelled (Escape,
	 * Back), or it couldn't be opened (then a notification says so).
	 */
	async open(blockKey: string, view: BlockOverlayView): Promise<boolean> {
		const current = this.#current;
		// A repeated click while preparing; anything once `edit()` has gone to the route: the page stays clickable until
		// Umbraco shows the overlay, and taking over then would leave a route without an overlay.
		if (current && (current.phase !== 'preparing' || current.blockKey === blockKey)) return false;
		// Nothing yet, or one still preparing: this one takes over.
		const request: Request = { blockKey, phase: 'preparing' };
		this.#current = request;
		let opened = false;
		try {
			opened = await this.#open(request, view);
			return opened;
		} finally {
			// Not opened: free for the next click (unless a newer request took over). Opened: until it has closed.
			if (!opened && this.#current === request) this.#current = undefined;
		}
	}

	async #open(request: Request, view: BlockOverlayView): Promise<boolean> {
		const superseded = () => this.#current !== request;
		const holder = locateBlockHolder(this.#workspace?.getValues() ?? [], request.blockKey, this.culture);
		if (!holder) return this.#failed();

		this.#showHolder({ ownerKey: holder.ownerKey, alias: holder.alias });
		await this.updateComplete;

		const entry = await this.#findEntry(request.blockKey, superseded);
		if (superseded()) return false;
		if (!entry) return this.#failed();

		const context = await contextOf(entry, UMB_BLOCK_ENTRY_CONTEXT);
		if (superseded()) return false;
		if (!context) return this.#failed();

		// Umbraco's own rules: the content overlay only when the block has content to edit there, else its settings.
		// `showContentEdit` is false until the block's types have loaded, so wait for those first.
		await typesLoaded(entry, context);
		if (superseded()) return false;
		const hasSettings = !!context.getSettings();
		const showContent = (await firstValue(context.showContentEdit, () => true)) === true;
		const settings = hasSettings && (view === 'settings' || !showContent);
		if (!settings && !showContent) {
			this.#showHolder(undefined); // e.g. a divider: nothing to open
			return false;
		}

		// `edit()` goes to the overlay's route, which the property editor registers asynchronously; before that it
		// doesn't go anywhere.
		const path = await firstValue(
			settings ? context.workspaceEditSettingsPath : context.workspaceEditContentPath,
			(value) => !!value,
		);
		if (superseded()) return false;
		if (!path) return this.#failed();

		const modals = await this.getContext(UMB_MODAL_MANAGER_CONTEXT);
		if (!modals || superseded()) return false;
		// The user left the view meanwhile: the overlay's route would take them back to it.
		if (!this.isConnected) {
			this.#showHolder(undefined);
			return false;
		}
		const before = new Set(await firstValue(modals.modals, () => true));
		// The overlay's route without its view (`…/block/edit/<key>`): in the URL while it's open, whichever view shows.
		const route = path.slice(0, path.lastIndexOf('/view/'));
		request.phase = 'navigated';
		if (settings) context.editSettings();
		else context.edit();

		const modal = await whenShown(modals.modals, before, route);
		if (!modal) {
			// The route left the URL before the overlay showed (Escape, Back): cancelled, nothing to say.
			if (!inUrl(route)) {
				this.#showHolder(undefined);
				return false;
			}
			return this.#failed();
		}

		request.phase = 'shown';
		void this.#whenClosed(modal, request);
		return true;
	}

	/** The overlay closed (Close, Update, Escape, browser Back) and Umbraco has removed it: its property editor can go. */
	async #whenClosed(modal: UmbModalContext, request: Request) {
		try {
			await modal.onSubmit();
		} catch {
			// Closed without submitting.
		}
		this.#showHolder(undefined);
		if (this.#current === request) this.#current = undefined;
		this.dispatchEvent(new CustomEvent('closed'));
	}

	#showHolder(holder: Holder | undefined) {
		this._holder = holder;
	}

	/** The block's entry element, once the hidden property editor has rendered it. */
	async #findEntry(blockKey: string, superseded: () => boolean) {
		const deadline = Date.now() + WAIT_MS;
		while (!superseded() && Date.now() < deadline) {
			const entry = this.shadowRoot ? findBlockEntry(this.shadowRoot, blockKey) : null;
			if (entry) return entry;
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		}
		return null;
	}

	/** Says the overlay couldn't be opened, and where the block can still be edited. */
	async #failed() {
		this.#showHolder(undefined);
		const notifications = await this.getContext(UMB_NOTIFICATION_CONTEXT);
		notifications?.peek('warning', {
			data: {
				headline: this.localize.term('arjoVisualEditor_overlayFailed'),
				message: this.localize.term('arjoVisualEditor_overlayFailedHint'),
			},
		});
		return false;
	}

	override render() {
		const holder = this._holder;
		if (!holder) return nothing;
		// Keyed: a new property editor for another property. The overlay stays open as long as its editor does.
		return keyed(
			`${holder.ownerKey ?? 'document'}/${holder.alias}`,
			holder.ownerKey === null
				? html`<umb-content-workspace-property .alias=${holder.alias}></umb-content-workspace-property>`
				: html`<arjo-visual-editor-block-editor
						.blockKey=${holder.ownerKey}
						.culture=${this.culture}
						.onlyAlias=${holder.alias}
					></arjo-visual-editor-block-editor>`,
		);
	}

	static override styles = css`
		/* Only there to register the overlay's route and provide its contexts. */
		:host {
			display: none;
		}
	`;
}

/** The context `token` an entry element gets (asked from the element itself), or undefined. */
async function contextOf<T extends UmbContextMinimal>(
	entry: HTMLElement,
	token: UmbContextToken<T>,
): Promise<T | undefined> {
	const consumer = new UmbContextConsumer(entry, token);
	const context = consumer.asPromise();
	consumer.hostConnected();
	try {
		return await Promise.race([context, delay(WAIT_MS)]);
	} catch {
		return undefined;
	} finally {
		consumer.destroy();
	}
}

/**
 * Waits (each step bounded) until the block's element types and block type have loaded. The block manager adds the
 * types' structures before loading them, so until then `showContentEdit` is false for every block, and the overlay
 * would open on settings. Its public `contentTypesLoaded` covers compositions too.
 */
async function typesLoaded(entry: HTMLElement, context: typeof UMB_BLOCK_ENTRY_CONTEXT.TYPE) {
	const manager = await contextOf(entry, UMB_BLOCK_MANAGER_CONTEXT);
	await Promise.race([manager?.contentTypesLoaded.catch(() => undefined), delay(WAIT_MS)]);
	// Part of `showContentEdit` on every kind of entry (Block List, Grid, RTE, Single), but not on the base class.
	const forceHide = (context as { forceHideContentEditorInOverlay?: Observable<boolean | undefined> })
		.forceHideContentEditorInOverlay;
	if (forceHide) await firstValue(forceHide, (value) => value !== undefined);
}

/**
 * The modal that `edit()` opened, once Umbraco shows it: one in `modals` that wasn't there `before`. Undefined when the
 * overlay's route left the URL first (cancelled), or after SHOW_MS.
 */
function whenShown(
	modals: Observable<Array<UmbModalContext>>,
	before: Set<UmbModalContext>,
	route: string,
): Promise<UmbModalContext | undefined> {
	return new Promise((resolve) => {
		let done = false;
		// `edit()` changes the URL itself, but don't count on that being synchronous.
		let routed = inUrl(route);
		const deadline = Date.now() + SHOW_MS;
		const finish = (modal?: UmbModalContext) => {
			if (done) return;
			done = true;
			clearInterval(timer);
			queueMicrotask(() => subscription.unsubscribe());
			resolve(modal);
		};
		const timer = setInterval(() => {
			if (inUrl(route)) routed = true;
			else if (routed) finish(undefined);
			if (Date.now() > deadline) finish(undefined);
		}, POLL_MS);
		const subscription = modals.subscribe((list) => {
			const modal = list.find((m) => !before.has(m));
			if (modal) finish(modal);
		});
	});
}

/** The overlay's route is in the URL; how Umbraco itself checks for a routed modal's path. */
function inUrl(route: string | undefined) {
	return !!route && window.location.href.toLowerCase().includes(route.toLowerCase());
}

/** The first value of `source` that `accept`s, or undefined after WAIT_MS. */
function firstValue<T>(source: Observable<T>, accept: (value: T) => boolean): Promise<T | undefined> {
	return new Promise((resolve) => {
		let done = false;
		const finish = (value?: T) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			// A synchronous first value arrives before `subscribe` returns.
			queueMicrotask(() => subscription.unsubscribe());
			resolve(value);
		};
		const timer = setTimeout(() => finish(undefined), WAIT_MS);
		const subscription = source.subscribe((value) => {
			if (accept(value)) finish(value);
		});
	});
}

const delay = (ms: number) => new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms));

export default ArjoVisualEditorBlockOverlayElement;

declare global {
	interface HTMLElementTagNameMap {
		'arjo-visual-editor-block-overlay': ArjoVisualEditorBlockOverlayElement;
	}
}
