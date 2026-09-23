import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import type { UmbConditionConfigBase, UmbExtensionCondition } from '@umbraco-cms/backoffice/extension-api';
import { UmbConditionBase } from '@umbraco-cms/backoffice/extension-registry';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { observeHasTemplate } from './availability.js';

export { ARJO_VISUAL_EDITOR_AVAILABLE_CONDITION_ALIAS } from './constants.js';

/** Permits an extension when the current document has a template, so visual mode has something to render. */
export class ArjoVisualEditorAvailableCondition
	extends UmbConditionBase<UmbConditionConfigBase>
	implements UmbExtensionCondition
{
	constructor(
		host: UmbControllerHost,
		args: { config: UmbConditionConfigBase; onChange: (permitted: boolean) => void },
	) {
		super(host, args);
		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
			if (!workspace) return;
			observeHasTemplate(this, workspace, (hasTemplate) => (this.permitted = hasTemplate));
		});
	}
}

export { ArjoVisualEditorAvailableCondition as api };
