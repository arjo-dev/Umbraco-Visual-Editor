import { UmbContextBase } from '@umbraco-cms/backoffice/class-api';
import { UmbContextToken } from '@umbraco-cms/backoffice/context-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UmbBooleanState } from '@umbraco-cms/backoffice/observable-api';

/**
 * App-wide state: is the visual editor currently showing? Conditions use it to hide backoffice chrome
 * (the section sidebar/tree) so the canvas gets the whole screen. See docs/adr/0003-backoffice-integration.md.
 */
export class ArjoVisualModeContext extends UmbContextBase {
	#active = new UmbBooleanState(false);
	readonly active = this.#active.asObservable();

	constructor(host: UmbControllerHost) {
		super(host, ARJO_VISUAL_MODE_CONTEXT);
	}

	setActive(active: boolean) {
		this.#active.setValue(active);
	}

	getActive() {
		return this.#active.getValue();
	}
}

export const ARJO_VISUAL_MODE_CONTEXT = new UmbContextToken<ArjoVisualModeContext>(
	'Arjo.VisualEditor.Context.VisualMode',
);

export { ArjoVisualModeContext as api };
