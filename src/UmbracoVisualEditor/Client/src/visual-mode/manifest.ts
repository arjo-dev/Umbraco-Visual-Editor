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
	// Where each user's documents open (#48): their choice, in their profile.
	{
		type: 'userProfileApp',
		alias: 'Arjo.VisualEditor.UserProfileApp.OpenDocumentsIn',
		name: 'Arjo Visual Editor Open Documents In User Profile App',
		element: () => import('./visual-editor-profile-app.element.js'),
		weight: 150,
		meta: { label: '#arjoVisualEditor_tabName', pathname: 'visual-editor' },
	},
	{
		type: 'workspaceContext',
		alias: 'Arjo.VisualEditor.WorkspaceContext.OpenInVisualEditor',
		name: 'Arjo Visual Editor Open In Visual Editor Workspace Context',
		api: () => import('./open-in-visual-editor.workspace-context.js'),
		conditions: [{ alias: 'Umb.Condition.WorkspaceAlias', match: 'Umb.Workspace.Document' }],
	},
];
