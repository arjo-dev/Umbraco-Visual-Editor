/**
 * Tiptap's `focus` command, for an editor whose element is in the canvas frame while the code runs in the backoffice
 * window (ADR 0004). The core command focuses from the backoffice window in an animation frame. Once focus has left
 * the frame (e.g. a toolbar button in the side panel was clicked) it doesn't get back in, and typing goes nowhere.
 * This one focuses the editor element itself, straight away, which moves focus into the frame.
 *
 * A factory taking the Tiptap module, so it's built with the same Tiptap as the editor: the backoffice's
 * (`@umbraco-cms/backoffice/external/tiptap`) in the product, npm's in the tests.
 */
import type { Extension as TiptapExtension, resolveFocusPosition as ResolveFocusPosition } from '@tiptap/core';

export interface TiptapModule {
	Extension: typeof TiptapExtension;
	resolveFocusPosition: typeof ResolveFocusPosition;
}

export function createFrameFocus({ Extension, resolveFocusPosition }: TiptapModule) {
	return Extension.create({
		name: 'arjoFrameFocus',
		addCommands() {
			return {
				focus:
					(position = null) =>
					({ editor, view, tr, dispatch }) => {
						if ((view.hasFocus() && position === null) || position === false) return true;
						const selection = resolveFocusPosition(tr.doc, position) || editor.state.selection;
						if (dispatch) {
							if (!editor.state.selection.eq(selection)) tr.setSelection(selection);
							else if (tr.storedMarks) tr.setStoredMarks(tr.storedMarks);
							view.dom.focus({ preventScroll: true });
						}
						return true;
					},
			};
		},
	});
}
