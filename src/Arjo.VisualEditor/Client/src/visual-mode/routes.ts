/** Route helpers for the Visual editor workspace view. */

export const VISUAL_EDITOR_VIEW_PATHNAME = 'visual-editor';

/** Matches a document workspace URL, capturing the part up to and including the variant segment. */
const DOCUMENT_ROUTE = /^(.*\/workspace\/document\/edit\/[^/]+\/[^/]+)(\/view\/([^/]+))?\/?$/;

/** The workspace view pathname in a document URL (e.g. "content", "visual-editor"), or null if none is given. */
export function viewInPath(pathname: string): { base: string; view: string | null } | null {
	const match = DOCUMENT_ROUTE.exec(pathname);
	return match ? { base: match[1], view: match[3] ?? null } : null;
}
