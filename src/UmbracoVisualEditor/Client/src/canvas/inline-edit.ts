/**
 * Inline editing of plain text properties on the canvas (#20). Double-click (or Enter on the selection) asks the host
 * with `inlineEditStart`. The host checks the element shows the value as it is stored (not transformed by the
 * template), that the user may edit it, and its max length. It then answers `beginInlineEdit`, and the element becomes
 * `contenteditable="plaintext-only"`. Changes go to the host as `inlineEdit` (debounced); Escape cancels, blur or
 * Enter (single line) commits, both ending with `inlineEditEnd`.
 */
import { sameTarget, type CanvasMessage, type HostMessage } from '../protocol/index.js';
import type { CanvasTarget } from './targets.js';

/** Property editors that can be edited in place, and whether they're multi-line. */
export const INLINE_EDITORS: Record<string, boolean> = {
	'Umbraco.TextBox': false,
	'Umbraco.TextArea': true,
};

const SEND_DEBOUNCE_MS = 150;

/**
 * The element to edit `target` in: one showing only its text (no child elements), preferring the one containing
 * `from` (e.g. the double-clicked node). Null when the target isn't a plain text property.
 */
export function inlineEditableElement(target: CanvasTarget | null, from?: Node | null): HTMLElement | null {
	if (!target || target.ref.kind !== 'Property' || !target.editorAlias) return null;
	if (!(target.editorAlias in INLINE_EDITORS)) return null;
	const candidates = from ? target.elements.filter((el) => el.contains(from)) : target.elements;
	const element = candidates.find((el) => el.childElementCount === 0 && 'isContentEditable' in el);
	return (element as HTMLElement | undefined) ?? null;
}

/** An element's text as the value it shows: without the template's surrounding whitespace. */
export const elementText = (element: Element) => (element.textContent ?? '').trim();

type BeginMessage = Extract<HostMessage, { type: 'beginInlineEdit' }>;

export class InlineEditor {
	#doc: Document;
	#send: (message: CanvasMessage) => void;
	#onEnd: () => void;
	#requested: { target: CanvasTarget; element: HTMLElement } | null = null;
	#editing: {
		target: CanvasTarget;
		element: HTMLElement;
		original: string;
		lastSent: string;
		maxLength: number | null;
		multiline: boolean;
	} | null = null;
	#timer?: ReturnType<typeof setTimeout>;

	constructor(doc: Document, send: (message: CanvasMessage) => void, onEnd: () => void) {
		this.#doc = doc;
		this.#send = send;
		this.#onEnd = onEnd;
	}

	/** The target being edited, if any. */
	get active() {
		return this.#editing?.target ?? null;
	}

	get element() {
		return this.#editing?.element ?? null;
	}

	/** Asks the host whether `target` can be edited in place, in `element`. */
	request(target: CanvasTarget, element: HTMLElement) {
		if (this.#editing) return;
		this.#requested = { target, element };
		this.#send({ type: 'inlineEditStart', target: target.ref, text: elementText(element) });
	}

	/** The host's go-ahead for the last request. */
	begin(message: BeginMessage) {
		const requested = this.#requested;
		this.#requested = null;
		if (this.#editing && sameTarget(this.#editing.target.ref, message.target)) return; // already editing it
		if (
			!requested ||
			this.#editing ||
			!sameTarget(requested.target.ref, message.target) ||
			!requested.element.isConnected
		) {
			// Not waiting for this any more (e.g. something else was clicked meanwhile): release the host.
			this.#send({ type: 'inlineEditEnd', target: message.target, cancelled: false });
			return;
		}

		const { element } = requested;
		const original = elementText(element);
		this.#editing = {
			...requested,
			original,
			lastSent: original,
			maxLength: message.maxLength,
			multiline: message.multiline,
		};
		element.setAttribute('contenteditable', 'plaintext-only');
		element.addEventListener('input', this.#onInput);
		element.addEventListener('keydown', this.#onKeyDown);
		element.addEventListener('blur', this.#onBlur);
		element.focus({ preventScroll: true });

		// Keep a selection the double-click made inside the element; otherwise put the caret at the end.
		const selection = this.#doc.getSelection();
		if (selection && !(selection.rangeCount && element.contains(selection.getRangeAt(0).commonAncestorContainer))) {
			selection.selectAllChildren(element);
			selection.collapseToEnd();
		}
	}

	/** Ends editing, keeping the text. */
	commit() {
		this.#end(false);
	}

	/** Ends editing and puts the original text back. */
	cancel() {
		this.#end(true);
	}

	/** Stops without telling the host (the runtime is going away). */
	destroy() {
		clearTimeout(this.#timer);
		this.#requested = null;
		if (this.#editing) this.#detach(this.#editing.element);
		this.#editing = null;
	}

	#onInput = () => {
		const editing = this.#editing;
		if (!editing) return;
		const { element, maxLength, multiline } = editing;
		const text = element.textContent ?? '';
		let allowed = multiline ? text : text.replace(/[\r\n]+/g, ' ');
		if (maxLength !== null && allowed.trim().length > maxLength) allowed = allowed.trimStart().slice(0, maxLength);
		if (allowed !== text) {
			element.textContent = allowed;
			const selection = this.#doc.getSelection();
			selection?.selectAllChildren(element);
			selection?.collapseToEnd();
		}
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.#flush(), SEND_DEBOUNCE_MS);
	};

	#onKeyDown = (event: KeyboardEvent) => {
		if (!this.#editing) return;
		// The runtime's own keys (Escape selects the parent) don't apply while typing.
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			this.cancel();
		} else if (event.key === 'Enter' && !this.#editing.multiline) {
			event.preventDefault();
			this.commit();
		}
	};

	#onBlur = () => this.commit();

	#flush() {
		clearTimeout(this.#timer);
		const editing = this.#editing;
		if (!editing) return;
		const value = elementText(editing.element);
		if (value === editing.lastSent) return;
		editing.lastSent = value;
		this.#send({ type: 'inlineEdit', target: editing.target.ref, value });
	}

	#end(cancelled: boolean) {
		const editing = this.#editing;
		if (!editing) return;
		if (cancelled) {
			clearTimeout(this.#timer);
			editing.element.textContent = editing.original;
		} else {
			this.#flush();
		}
		this.#editing = null;
		this.#detach(editing.element);
		this.#send({ type: 'inlineEditEnd', target: editing.target.ref, cancelled });
		this.#onEnd();
	}

	#detach(element: HTMLElement) {
		element.removeEventListener('input', this.#onInput);
		element.removeEventListener('keydown', this.#onKeyDown);
		element.removeEventListener('blur', this.#onBlur);
		element.removeAttribute('contenteditable');
		if (this.#doc.activeElement === element) element.blur();
	}
}
