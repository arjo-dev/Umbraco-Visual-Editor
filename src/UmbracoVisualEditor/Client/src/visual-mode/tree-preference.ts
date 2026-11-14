/**
 * The user's choice to keep the content tree visible in visual mode (ADR 0003), remembered per browser. Kept apart
 * from the visual mode context so it can be tested without the backoffice.
 */
const SHOW_TREE_STORAGE_KEY = 'arjo.visualEditor.showTree';

/** The remembered choice; null when the user hasn't made one (or it can't be read). */
export function readShowTree(): boolean | null {
	try {
		const stored = localStorage.getItem(SHOW_TREE_STORAGE_KEY);
		return stored === null ? null : stored === 'true';
	} catch {
		return null;
	}
}

/** Remembers the choice; without storage it only lasts until the backoffice reloads. */
export function writeShowTree(show: boolean) {
	try {
		localStorage.setItem(SHOW_TREE_STORAGE_KEY, String(show));
	} catch {
		// Not remembered; the toggle still works for now.
	}
}

/**
 * Whether the tree shows: the user's choice, or else the default for the editor mode (VisualEditor:EditorMode):
 * hidden in side panel mode, so the canvas gets the room; shown in overlay mode, where the editor works next to it.
 */
export const showTreeFor = (overlayMode: boolean) => readShowTree() ?? overlayMode;
