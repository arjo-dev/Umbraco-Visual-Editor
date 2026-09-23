import type { UmbEntryPointOnInit, UmbEntryPointOnUnload } from '@umbraco-cms/backoffice/extension-api';
import { UMB_AUTH_CONTEXT } from '@umbraco-cms/backoffice/auth';
import { client } from '../api/client.gen.js';

export const onInit: UmbEntryPointOnInit = async (host) => {
	// Wire the generated API client into the backoffice auth context (base URL, bearer token refresh,
	// default interceptors). onInit is awaited, so the client is configured before any of our elements use it.
	const authContext = await host.getContext(UMB_AUTH_CONTEXT);
	if (!authContext) {
		console.warn('[Arjo.VisualEditor] UMB_AUTH_CONTEXT not available — API client will not be authenticated');
		return;
	}
	authContext.configureClient(client);

	console.debug('[Arjo.VisualEditor] loaded');
};

// Required by UmbEntryPointModule; nothing to tear down yet.
export const onUnload: UmbEntryPointOnUnload = () => {};
