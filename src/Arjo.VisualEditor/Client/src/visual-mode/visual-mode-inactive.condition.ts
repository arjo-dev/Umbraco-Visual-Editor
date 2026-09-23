import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import type { UmbConditionConfigBase, UmbExtensionCondition } from '@umbraco-cms/backoffice/extension-api';
import { UmbConditionBase } from '@umbraco-cms/backoffice/extension-registry';
import { ARJO_VISUAL_MODE_CONTEXT } from './visual-mode.context.js';

export const ARJO_VISUAL_MODE_INACTIVE_CONDITION_ALIAS = 'Arjo.VisualEditor.Condition.VisualModeInactive';

/** Permits an extension only while the visual editor is *not* showing. */
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
			this.observe(context?.active, (active) => (this.permitted = !active));
		});
	}
}

export { ArjoVisualModeInactiveCondition as api };
