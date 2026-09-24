import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UmbObserverController } from '@umbraco-cms/backoffice/observable-api';
import type { UmbDocumentWorkspaceContext } from '@umbraco-cms/backoffice/document';

/**
 * The Visual editor tab is offered for documents with a template: without one there is nothing to render.
 * Unsaved documents still get the tab; the view explains they must be saved first (render sessions overlay the
 * document's draft, ADR 0001). Per-document-type configuration comes with #32.
 */
export function observeHasTemplate(
	host: UmbControllerHost,
	workspace: UmbDocumentWorkspaceContext,
	callback: (hasTemplate: boolean) => void,
) {
	new UmbObserverController(host, workspace.templateId, (templateId) => callback(!!templateId), 'arjoHasTemplate');
}
