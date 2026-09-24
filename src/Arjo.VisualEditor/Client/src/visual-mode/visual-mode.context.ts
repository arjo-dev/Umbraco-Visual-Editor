import { UmbContextBase } from '@umbraco-cms/backoffice/class-api';
import { UmbContextToken } from '@umbraco-cms/backoffice/context-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UmbBooleanState, mergeObservables } from '@umbraco-cms/backoffice/observable-api';

const SHOW_TREE_STORAGE_KEY = 'arjo.visualEditor.showTree';

/**
 * App-wide state: is the visual editor currently showing, and does the user want the section sidebar (content
 * tree) kept in visual mode? Conditions use `hideSidebar` to hide backoffice chrome so the canvas gets the whole
 * screen (docs/adr/0003-backoffice-integration.md). The tree preference is remembered per browser.
 */
export class ArjoVisualModeContext extends UmbContextBase {
	#active = new UmbBooleanState(false);
	readonly active = this.#active.asObservable();

	#showTree = new UmbBooleanState(readShowTree());
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

	setShowTree(show: boolean) {
		this.#showTree.setValue(show);
		try {
			localStorage.setItem(SHOW_TREE_STORAGE_KEY, String(show));
		} catch {
			// Not remembered; the toggle still works for now.
		}
	}

	getShowTree() {
		return this.#showTree.getValue();
	}
}

function readShowTree() {
	try {
		return localStorage.getItem(SHOW_TREE_STORAGE_KEY) === 'true';
	} catch {
		return false;
	}
}

export const ARJO_VISUAL_MODE_CONTEXT = new UmbContextToken<ArjoVisualModeContext>(
	'Arjo.VisualEditor.Context.VisualMode',
);

export { ArjoVisualModeContext as api };
