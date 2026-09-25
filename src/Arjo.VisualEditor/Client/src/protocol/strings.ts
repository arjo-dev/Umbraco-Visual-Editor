/**
 * The canvas's own words (#35): its overlay runs in the site's page, where the backoffice's localisation isn't
 * available. These English strings ship with it; the host sends the backoffice user's translations in `setStrings`
 * (terms `arjoVisualEditorCanvas_*`, see localization/en.ts). `{0}` is filled in with `format`.
 */
export const DEFAULT_CANVAS_STRINGS = {
	block: 'Block',
	sharedAcrossLanguages: 'Shared across languages',
	editInSidePanel: 'Edit the content in the side panel',
	addBlock: 'Add block',
	addBefore: 'Add a block before this one',
	addAfter: 'Add a block after this one',
	moveUp: 'Move up',
	moveDown: 'Move down',
	duplicate: 'Duplicate',
	copy: 'Copy',
	settings: 'Settings',
	delete: 'Delete',
	dragToMove: 'Drag to move {0}',
	dragToResize: 'Drag to change the width of {0}',
	selectParent: 'Select {0}',
	actions: '{0} actions',
	/** Announced to screen readers when something is selected: the selection's name. */
	selected: '{0} selected',
	/** Announced when the selection is cleared. */
	nothingSelected: 'Nothing selected',
};

export type CanvasStrings = typeof DEFAULT_CANVAS_STRINGS;
export type CanvasStringKey = keyof CanvasStrings;

export const CANVAS_STRING_KEYS = Object.keys(DEFAULT_CANVAS_STRINGS) as CanvasStringKey[];

/** Fills in `{0}`, `{1}`, … */
export const format = (text: string, ...args: unknown[]) =>
	text.replace(/\{(\d+)\}/g, (match, i: string) => (args[Number(i)] === undefined ? match : String(args[Number(i)])));
