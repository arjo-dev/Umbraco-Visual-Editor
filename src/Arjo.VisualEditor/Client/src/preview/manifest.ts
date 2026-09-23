import { ARJO_VISUAL_EDITOR_AVAILABLE_CONDITION_ALIAS } from '../visual-mode/constants.js';
import { VISUAL_EDITOR_VIEW_PATHNAME } from '../visual-mode/preference.js';

export const manifests: Array<UmbExtensionManifest> = [
	{
		type: 'workspaceView',
		alias: 'Arjo.VisualEditor.WorkspaceView.Preview',
		name: 'Arjo Visual Editor Preview Workspace View',
		element: () => import('./visual-preview-workspace-view.element.js'),
		// After Content (200), before Info (100): documents still open on Content.
		weight: 150,
		meta: {
			label: 'Visual editor',
			pathname: VISUAL_EDITOR_VIEW_PATHNAME,
			icon: 'icon-display',
		},
		conditions: [
			{
				alias: 'Umb.Condition.WorkspaceAlias',
				match: 'Umb.Workspace.Document',
			},
			// Hidden for documents that can't render yet: never saved, or no template.
			{ alias: ARJO_VISUAL_EDITOR_AVAILABLE_CONDITION_ALIAS },
		],
	},
];
