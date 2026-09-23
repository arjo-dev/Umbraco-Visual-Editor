/**
 * Each user's last choice between the standard editor and the visual editor, kept in localStorage (per browser).
 * Storage can be unavailable (private windows, blocked site data), so every access is guarded.
 */
export type VisualEditorMode = 'content' | 'visual';

const key = (userKey: string | undefined) => `arjo.visualEditor.mode.${userKey ?? 'anonymous'}`;

export function getPreferredMode(userKey: string | undefined): VisualEditorMode {
	try {
		return localStorage.getItem(key(userKey)) === 'visual' ? 'visual' : 'content';
	} catch {
		return 'content';
	}
}

export function setPreferredMode(userKey: string | undefined, mode: VisualEditorMode) {
	// Until the current user has loaded there's nobody to remember it for.
	if (!userKey) return;
	try {
		localStorage.setItem(key(userKey), mode);
	} catch {
		// Not remembered; the editor still works.
	}
}

export const VISUAL_EDITOR_VIEW_PATHNAME = 'visual-editor';

/** Matches a document workspace URL, capturing the part up to and including the variant segment. */
const DOCUMENT_ROUTE = /^(.*\/workspace\/document\/edit\/[^/]+\/[^/]+)(\/view\/([^/]+))?\/?$/;

/** The workspace view pathname in a document URL (e.g. "content", "visual-editor"), or null if none is given. */
export function viewInPath(pathname: string): { base: string; view: string | null } | null {
	const match = DOCUMENT_ROUTE.exec(pathname);
	return match ? { base: match[1], view: match[3] ?? null } : null;
}
