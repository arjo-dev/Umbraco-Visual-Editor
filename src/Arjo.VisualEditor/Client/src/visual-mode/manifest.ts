import { ARJO_VISUAL_MODE_INACTIVE_CONDITION_ALIAS } from './visual-mode-inactive.condition.js';
import { ARJO_VISUAL_EDITOR_AVAILABLE_CONDITION_ALIAS } from './constants.js';

export const manifests: Array<UmbExtensionManifest> = [
	{
		type: 'globalContext',
		alias: 'Arjo.VisualEditor.GlobalContext.VisualMode',
		name: 'Arjo Visual Editor Visual Mode Context',
		api: () => import('./visual-mode.context.js'),
	},
	{
		type: 'condition',
		alias: ARJO_VISUAL_MODE_INACTIVE_CONDITION_ALIAS,
		name: 'Arjo Visual Editor Visual Mode Inactive Condition',
		api: () => import('./visual-mode-inactive.condition.js'),
	},
	{
		type: 'condition',
		alias: ARJO_VISUAL_EDITOR_AVAILABLE_CONDITION_ALIAS,
		name: 'Arjo Visual Editor Available Condition',
		api: () => import('./visual-editor-available.condition.js'),
	},
];
