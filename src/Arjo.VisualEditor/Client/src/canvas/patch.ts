/**
 * Live re-render (#18): fetch a newer render of the page and patch it into the current document instead of
 * reloading the frame, so scroll position, focus and the site's running scripts survive an edit.
 */
import { Idiomorph } from 'idiomorph';

/** Fetches a render-session page and parses it. Null when it didn't render normally (no marker manifest). */
export async function fetchRender(url: string, signal?: AbortSignal): Promise<Document | null> {
	const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' }, signal });
	if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return null;
	const next = new DOMParser().parseFromString(await response.text(), 'text/html');
	return next.getElementById('uve-markers') ? next : null;
}

/**
 * Morphs `doc` into `next` (idiomorph): unchanged elements are kept as they are, changed ones are updated in place.
 * `keep` protects our own elements (the overlay), which the server's markup doesn't contain.
 *
 * - The head is merged: new stylesheets are added and removed ones dropped, so styling follows the template.
 * - Scripts already on the page keep running; ones that only appear in the new render aren't run. A change that
 *   needs a site script to initialise (a new carousel block, say) shows fully after a reload.
 */
export function patchDocument(doc: Document, next: Document, keep: (node: Node) => boolean) {
	Idiomorph.morph(doc.documentElement, next.documentElement, {
		morphStyle: 'outerHTML',
		restoreFocus: true,
		head: { style: 'merge', shouldPreserve: keep },
		callbacks: { beforeNodeRemoved: (node) => !keep(node) },
	});
}
