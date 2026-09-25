import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UmbObserverController } from '@umbraco-cms/backoffice/observable-api';
import type { UmbDocumentWorkspaceContext } from '@umbraco-cms/backoffice/document';
import { getConfiguration, type VisualEditorConfigurationResponseModel } from '../api/index.js';

/**
 * The Visual editor tab is offered for documents with a template: without one there is nothing to render.
 * Unsaved documents still get the tab; the view explains they must be saved first (render sessions overlay the
 * document's draft, ADR 0001).
 */
export function observeHasTemplate(
	host: UmbControllerHost,
	workspace: UmbDocumentWorkspaceContext,
	callback: (hasTemplate: boolean) => void,
) {
	new UmbObserverController(host, workspace.templateId, (templateId) => callback(!!templateId), 'arjoHasTemplate');
}

/** Mirrors VisualEditorOptions.IsEnabledFor on the server (#32): aliases compare case-insensitively. */
export function isEnabledFor(configuration: VisualEditorConfigurationResponseModel, documentTypeAlias: string) {
	const alias = documentTypeAlias.toLowerCase();
	const has = (aliases: Array<string>) => aliases.some((a) => a.toLowerCase() === alias);
	return (
		configuration.enabled &&
		(configuration.allowedDocumentTypes.length === 0 || has(configuration.allowedDocumentTypes)) &&
		!has(configuration.excludedDocumentTypes)
	);
}

let configuration: Promise<VisualEditorConfigurationResponseModel | undefined> | undefined;

/**
 * The settings, fetched once per backoffice load. If they can't be fetched the tab stays offered: the render endpoint
 * enforces them anyway and the view shows its error.
 */
export function loadConfiguration() {
	configuration ??= getConfiguration()
		.then(({ data }) => data)
		.catch(() => undefined);
	return configuration;
}

/** Whether the settings offer the Visual editor for the workspace's document type. */
export function observeEnabledForDocumentType(
	host: UmbControllerHost,
	workspace: UmbDocumentWorkspaceContext,
	callback: (enabled: boolean) => void,
) {
	new UmbObserverController(
		host,
		workspace.structure.ownerContentTypeAlias,
		async (alias) => {
			if (!alias) return callback(false);
			const settings = await loadConfiguration();
			callback(!settings || isEnabledFor(settings, alias));
		},
		'arjoEnabledForDocumentType',
	);
}
