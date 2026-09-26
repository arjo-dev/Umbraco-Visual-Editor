import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import type { UmbConditionConfigBase, UmbExtensionCondition } from '@umbraco-cms/backoffice/extension-api';
import { UmbConditionBase } from '@umbraco-cms/backoffice/extension-registry';
import { ARJO_VISUAL_MODE_CONTEXT } from './visual-mode.context.js';

export const ARJO_VISUAL_MODE_INACTIVE_CONDITION_ALIAS = 'Arjo.VisualEditor.Condition.VisualModeInactive';

/** Permits an extension unless the visual editor is showing with the content tree hidden (the default). */
export class ArjoVisualModeInactiveCondition
	extends UmbConditionBase<UmbConditionConfigBase>
	implements UmbExtensionCondition
{
	constructor(
		host: UmbControllerHost,
		args: { config: UmbConditionConfigBase; onChange: (permitted: boolean) => void },
	) {
		super(host, args);
		// Permit until told otherwise, so chrome doesn't flicker away while the context resolves.
		this.permitted = true;
		this.consumeContext(ARJO_VISUAL_MODE_CONTEXT, (context) => {
			this.observe(context?.hideSidebar, (hide) => (this.permitted = !hide));
		});
	}
}

export { ArjoVisualModeInactiveCondition as api };
