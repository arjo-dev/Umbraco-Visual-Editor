import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT, type UmbDocumentWorkspaceContext } from '@umbraco-cms/backoffice/document';
import { UMB_CURRENT_USER_CONTEXT } from '@umbraco-cms/backoffice/current-user';
import { observeEnabledForDocumentType, observeHasTemplate } from './availability.js';
import { getOpenDocumentsIn, visualEditorUrlFor } from './open-in.js';
import { viewInPath } from './routes.js';

/** How long to wait for the current user and the variant segment of the URL. */
const WAIT_MS = 2000;

/**
 * Opens documents in the Visual editor for users who chose that in their profile (#48). Only when the URL doesn't
 * already name a view (a link to a tab wins), when the Visual editor is offered for the document (saved, with a
 * template, and a document type the VisualEditor settings allow), and once per document: switching tabs afterwards is
 * up to the user.
 */
export class ArjoOpenInVisualEditorWorkspaceContext extends UmbControllerBase {
	#userKey?: string;
	#handled?: string;
	#isNew?: boolean;
	#hasTemplate = false;
	#enabled = false;

	constructor(host: UmbControllerHost) {
		super(host);

		this.consumeContext(UMB_CURRENT_USER_CONTEXT, (currentUser) => {
			this.observe(currentUser?.unique, (unique) => (this.#userKey = unique ?? undefined), 'arjoCurrentUser');
		});

		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
			if (!workspace) return;
			this.observe(workspace.isNew, (isNew) => this.#update(workspace, { isNew }), 'arjoIsNew');
			observeHasTemplate(this, workspace, (hasTemplate) => this.#update(workspace, { hasTemplate }));
			observeEnabledForDocumentType(this, workspace, (enabled) => this.#update(workspace, { enabled }));
		});
	}

	#update(
		workspace: UmbDocumentWorkspaceContext,
		change: { isNew?: boolean | undefined; hasTemplate?: boolean; enabled?: boolean },
	) {
		if ('isNew' in change) this.#isNew = change.isNew;
		if (change.hasTemplate !== undefined) this.#hasTemplate = change.hasTemplate;
		if (change.enabled !== undefined) this.#enabled = change.enabled;

		const documentKey = workspace.getUnique() ?? undefined;
		if (this.#isNew !== false || !this.#hasTemplate || !this.#enabled || !documentKey) return;
		if (this.#handled === documentKey) return;
		this.#handled = documentKey;
		void this.#openInVisualEditor();
	}

	async #openInVisualEditor() {
		// The current user loads asynchronously, and opening `…/edit/{id}` redirects to add the variant segment: wait
		// for both (briefly) before deciding.
		const until = Date.now() + WAIT_MS;
		while ((!this.#userKey || !viewInPath(location.pathname)) && Date.now() < until) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		if (getOpenDocumentsIn(this.#userKey) !== 'visual') return;
		const url = visualEditorUrlFor(location.pathname, location.search);
		if (!url) return;

		// Replace (not push), so Back doesn't bounce the user into the Visual editor again.
		history.replaceState(history.state, '', url);
		window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
	}
}

export { ArjoOpenInVisualEditorWorkspaceContext as api };
