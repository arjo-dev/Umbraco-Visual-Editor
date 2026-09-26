import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import type { UmbConditionConfigBase, UmbExtensionCondition } from '@umbraco-cms/backoffice/extension-api';
import { UmbConditionBase } from '@umbraco-cms/backoffice/extension-registry';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document';
import { observeEnabledForDocumentType, observeHasTemplate } from './availability.js';

export { ARJO_VISUAL_EDITOR_AVAILABLE_CONDITION_ALIAS } from './constants.js';

/**
 * Permits an extension when the current document has a template, so visual mode has something to render, and the
 * VisualEditor settings offer it for the document's type (#32).
 */
export class ArjoVisualEditorAvailableCondition
	extends UmbConditionBase<UmbConditionConfigBase>
	implements UmbExtensionCondition
{
	#hasTemplate = false;
	#enabled = false;

	constructor(
		host: UmbControllerHost,
		args: { config: UmbConditionConfigBase; onChange: (permitted: boolean) => void },
	) {
		super(host, args);
		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
			if (!workspace) return;
			observeHasTemplate(this, workspace, (hasTemplate) => {
				this.#hasTemplate = hasTemplate;
				this.#update();
			});
			observeEnabledForDocumentType(this, workspace, (enabled) => {
				this.#enabled = enabled;
				this.#update();
			});
		});
	}

	#update() {
		this.permitted = this.#hasTemplate && this.#enabled;
	}
}

export { ArjoVisualEditorAvailableCondition as api };
