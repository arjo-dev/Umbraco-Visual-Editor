import type { UmbExtensionRegistry } from '@umbraco-cms/backoffice/extension-api';
import type { ManifestBase } from '@umbraco-cms/backoffice/extension-api';
import { ARJO_VISUAL_MODE_INACTIVE_CONDITION_ALIAS } from './visual-mode-inactive.condition.js';

/**
 * Hides the section sidebar (content tree, language picker, etc.) while the visual editor is showing, using the
 * supported `appendCondition` API: the section only renders its sidebar when a sidebar app is permitted.
 * Applies to every sidebar app, including ones other packages register later.
 */
export function hideSidebarInVisualMode(registry: UmbExtensionRegistry<ManifestBase>) {
	const handled = new Set<string>();
	registry.byType('sectionSidebarApp').subscribe((apps) => {
		for (const app of apps) {
			if (handled.has(app.alias)) continue;
			handled.add(app.alias);
			registry.appendCondition(app.alias, { alias: ARJO_VISUAL_MODE_INACTIVE_CONDITION_ALIAS });
		}
	});
}
