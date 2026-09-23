import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UmbObserverController } from '@umbraco-cms/backoffice/observable-api';
import type { UmbDocumentWorkspaceContext } from '@umbraco-cms/backoffice/document';

/**
 * Visual mode needs something to render: the document must have been saved at least once (render sessions overlay
 * its draft, ADR 0001) and have a template. Per-document-type configuration comes with #32.
 */
export function observeVisualEditorAvailable(
	host: UmbControllerHost,
	workspace: UmbDocumentWorkspaceContext,
	callback: (available: boolean) => void,
) {
	let isNew: boolean | undefined;
	let templateId: string | null | undefined;
	const update = () => callback(isNew === false && !!templateId);

	new UmbObserverController(
		host,
		workspace.isNew,
		(value) => {
			isNew = value;
			update();
		},
		'arjoVisualEditorIsNew',
	);
	new UmbObserverController(
		host,
		workspace.templateId,
		(value) => {
			templateId = value;
			update();
		},
		'arjoVisualEditorTemplateId',
	);
}
