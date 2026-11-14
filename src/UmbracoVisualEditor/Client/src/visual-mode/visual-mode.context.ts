import { UmbContextBase } from '@umbraco-cms/backoffice/class-api';
import { UmbContextToken } from '@umbraco-cms/backoffice/context-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UmbBooleanState, mergeObservables } from '@umbraco-cms/backoffice/observable-api';
import { readShowTree, showTreeFor, writeShowTree } from './tree-preference.js';

/**
 * App-wide state: is the visual editor currently showing, and does the user want the section sidebar (content
 * tree) kept in visual mode? Conditions use `hideSidebar` to hide backoffice chrome so the canvas gets the whole
 * screen (docs/adr/0003-backoffice-integration.md). The tree preference is remembered per browser; until the user
 * makes a choice, the view sets its default for the editor mode (`setTreeDefault`).
 */
export class ArjoVisualModeContext extends UmbContextBase {
	#active = new UmbBooleanState(false);
	readonly active = this.#active.asObservable();

	#showTree = new UmbBooleanState(readShowTree() ?? false);
	/** The user's choice to keep the content tree visible while in visual mode. */
	readonly showTree = this.#showTree.asObservable();

	/** True while the visual editor is showing and the user hasn't asked for the tree. */
	readonly hideSidebar = mergeObservables([this.active, this.showTree], ([active, showTree]) => active && !showTree);

	constructor(host: UmbControllerHost) {
		super(host, ARJO_VISUAL_MODE_CONTEXT);
	}

	setActive(active: boolean) {
		this.#active.setValue(active);
	}

	getActive() {
		return this.#active.getValue();
	}

	/**
	 * Applies the tree's default for the editor mode (`showTreeFor`) unless the user has chosen. Called before
	 * `setActive(true)`, so the sidebar isn't hidden and shown again in between.
	 */
	setTreeDefault(overlayMode: boolean) {
		this.#showTree.setValue(showTreeFor(overlayMode));
	}

	setShowTree(show: boolean) {
		this.#showTree.setValue(show);
		writeShowTree(show);
	}

	getShowTree() {
		return this.#showTree.getValue();
	}
}

export const ARJO_VISUAL_MODE_CONTEXT = new UmbContextToken<ArjoVisualModeContext>(
	'Arjo.VisualEditor.Context.VisualMode',
);

export { ArjoVisualModeContext as api };
