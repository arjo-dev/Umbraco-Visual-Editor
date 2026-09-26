/**
 * Where a user's documents open (#48): the standard editor (the Content tab, as Umbraco does) or the Visual editor.
 * An explicit choice each user makes in their profile, never inferred from the tabs they use. Kept in this browser's
 * localStorage, per user.
 */
import { VISUAL_EDITOR_VIEW_PATHNAME, viewInPath } from './routes.js';

export type OpenDocumentsIn = 'standard' | 'visual';

const storageKey = (userKey: string) => `arjo.visualEditor.openDocumentsIn.${userKey}`;

export function getOpenDocumentsIn(userKey: string | undefined): OpenDocumentsIn {
	if (!userKey) return 'standard';
	try {
		return localStorage.getItem(storageKey(userKey)) === 'visual' ? 'visual' : 'standard';
	} catch {
		return 'standard';
	}
}

export function setOpenDocumentsIn(userKey: string, value: OpenDocumentsIn) {
	try {
		if (value === 'visual') localStorage.setItem(storageKey(userKey), value);
		else localStorage.removeItem(storageKey(userKey));
	} catch {
		// A convenience: without storage, documents open as Umbraco opens them.
	}
}

/**
 * The URL to open a document on in the Visual editor, when `pathname` is a document that doesn't name a view (a link
 * to a tab wins); null otherwise.
 */
export function visualEditorUrlFor(pathname: string, search = ''): string | null {
	const route = viewInPath(pathname);
	return route && route.view === null ? `${route.base}/view/${VISUAL_EDITOR_VIEW_PATHNAME}${search}` : null;
}
