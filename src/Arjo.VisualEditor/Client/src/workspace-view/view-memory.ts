import type { TargetRef } from '../protocol/index.js';

/**
 * What the Visual editor was showing for a document, kept while the backoffice is open. Switching to another
 * workspace view (e.g. Content) destroys the Visual editor; coming back restores the page, selection and scroll.
 */
export interface ViewMemory {
	/** The render request the page was made from (JSON), to tell whether the values have changed since. */
	request: string;
	/** Render-session URL, without the nonce. */
	url: string;
	selected: TargetRef | null;
	scrollY: number;
	savedAt: number;
}

/**
 * Render sessions expire 10 minutes after last use (RenderSession.cs); reuse one only well inside that, otherwise
 * render again.
 */
const REUSE_MS = 5 * 60 * 1000;

const memory = new Map<string, ViewMemory>();

const keyOf = (documentKey: string, culture: string | null) => `${documentKey}|${culture ?? ''}`;

export function rememberView(documentKey: string, culture: string | null, view: Omit<ViewMemory, 'savedAt'>) {
	memory.set(keyOf(documentKey, culture), { ...view, savedAt: Date.now() });
}

/** What was showing for this document and culture, if anything. `reusable` says whether its URL can still be loaded. */
export function recallView(documentKey: string, culture: string | null, now = Date.now()) {
	const view = memory.get(keyOf(documentKey, culture));
	return view ? { ...view, reusable: now - view.savedAt < REUSE_MS } : null;
}
