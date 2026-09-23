import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { UMB_CURRENT_USER_CONTEXT } from '@umbraco-cms/backoffice/current-user';
import { observeVisualEditorAvailable } from './availability.js';
import { getPreferredMode, VISUAL_EDITOR_VIEW_PATHNAME, viewInPath } from './preference.js';

/**
 * Opens documents in visual mode when that was the user's last choice. Only when the URL doesn't already name a
 * view (an explicit link to a tab wins), and only when visual mode is available for the document. Once per document.
 */
export class ArjoOpenPreferredModeWorkspaceContext extends UmbControllerBase {
	#userKey?: string;
	#handledDocument?: string;

	constructor(host: UmbControllerHost) {
		super(host);

		this.consumeContext(UMB_CURRENT_USER_CONTEXT, (currentUser) => {
			this.observe(currentUser?.unique, (unique) => (this.#userKey = unique ?? undefined), 'arjoCurrentUser');
		});

		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
			if (!workspace) return;
			observeVisualEditorAvailable(this, workspace, (available) => {
				const documentKey = workspace.getUnique() ?? undefined;
				if (!available || !documentKey || this.#handledDocument === documentKey) return;
				this.#handledDocument = documentKey;
				void this.#openVisualIfPreferred();
			});
		});
	}

	async #openVisualIfPreferred() {
		// The preference is per user, and the current user loads asynchronously. Opening `…/edit/{id}` also redirects
		// to add the variant segment. Give both a moment (up to 2s).
		let route = viewInPath(location.pathname);
		for (let i = 0; (!route || !this.#userKey) && i < 20; i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			route = viewInPath(location.pathname);
		}
		if (!this.#userKey || getPreferredMode(this.#userKey) !== 'visual') return;
		if (!route || route.view !== null) return;

		// Replace (not push) so Back doesn't bounce the user into visual mode again.
		history.replaceState(history.state, '', `${route.base}/view/${VISUAL_EDITOR_VIEW_PATHNAME}${location.search}`);
		window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
	}
}

export { ArjoOpenPreferredModeWorkspaceContext as api };
