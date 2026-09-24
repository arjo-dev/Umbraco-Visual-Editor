/**
 * Inline rich text editing, the canvas side (#57, ADR 0004). The editor itself is created by the backoffice and
 * mounted on an element in this page; the canvas chooses that element, marks it for the host, and leaves it alone
 * while it is being edited.
 */
import { sameTarget, type CanvasMessage, type TargetRef } from '../protocol/index.js';
import type { CanvasTarget } from './targets.js';

export const RICH_TEXT_EDITOR = 'Umbraco.RichText';
/** Attribute marking the element the host mounts the editor on. */
export const MOUNT_ATTRIBUTE = 'data-uve-rte';

const isBlank = (node: Node) =>
	node.nodeType === Node.COMMENT_NODE || (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim());

/**
 * The element to mount a rich text editor on for `target`: the element that holds nothing but the rich text (the
 * editor then *is* the site's element, so its CSS applies unchanged). Otherwise a wrapper `<div>` is put around the
 * rich text's elements. Null when the target isn't rich text shown as elements.
 */
export function richTextMount(target: CanvasTarget | null): HTMLElement | null {
	if (!target || target.ref.kind !== 'Property' || target.editorAlias !== RICH_TEXT_EDITOR) return null;
	const elements = target.elements;
	const parent = elements[0]?.parentElement;
	if (!parent || !elements.every((el) => el.parentElement === parent)) return null;

	const onlyRichText = [...parent.childNodes].every((node) => elements.includes(node as Element) || isBlank(node));
	if (onlyRichText && parent !== parent.ownerDocument.body) return parent;

	const doc = parent.ownerDocument;
	const wrapper = doc.createElement('div');
	wrapper.setAttribute('data-uve-rte-wrapper', '');
	parent.insertBefore(wrapper, elements[0]);
	// Everything from the first to the last of its elements (text between them included).
	const last = elements[elements.length - 1];
	for (let node: ChildNode | null = wrapper.nextSibling; node;) {
		const next: ChildNode | null = node === last ? null : node.nextSibling;
		wrapper.append(node);
		node = next;
	}
	return wrapper;
}

/** The canvas's state for rich text editing: asked for, then active until the host says it ended. */
export class RichTextEditState {
	#send: (message: CanvasMessage) => void;
	#onEnd: () => void;
	#pending: { target: CanvasTarget; mount: HTMLElement } | null = null;
	#active: { target: CanvasTarget; mount: HTMLElement } | null = null;
	#nextId = 0;

	constructor(send: (message: CanvasMessage) => void, onEnd: () => void) {
		this.#send = send;
		this.#onEnd = onEnd;
	}

	/** The element being edited, if any: the canvas leaves events inside it to the editor. */
	get element() {
		return this.#active?.mount ?? null;
	}

	get active() {
		return this.#active?.target ?? null;
	}

	/** Asks the host to edit `target` in place; false when it isn't rich text the canvas can mount an editor on. */
	request(target: CanvasTarget | null): boolean {
		if (this.#active) return false;
		const mount = richTextMount(target);
		if (!target || !mount) return false;
		const mountId = `rte-${++this.#nextId}`;
		mount.setAttribute(MOUNT_ATTRIBUTE, mountId);
		this.#pending = { target, mount };
		this.#send({ type: 'richTextEditStart', target: target.ref, mountId });
		return true;
	}

	/** Asks the host to finish editing, keeping the changes (e.g. a click on the page outside the editor). */
	finish() {
		if (this.#active) this.#send({ type: 'inlineEditEnd', target: this.#active.target.ref, cancelled: false });
	}

	/** The host started or ended editing. */
	setActive(target: TargetRef, active: boolean) {
		if (active) {
			if (this.#pending && sameTarget(this.#pending.target.ref, target)) this.#active = this.#pending;
			this.#pending = null;
			return;
		}
		if (!this.#active || !sameTarget(this.#active.target.ref, target)) return;
		this.#active.mount.removeAttribute(MOUNT_ATTRIBUTE);
		this.#active = null;
		this.#onEnd();
	}
}
