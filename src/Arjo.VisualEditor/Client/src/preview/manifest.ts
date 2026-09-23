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
			pathname: 'visual-editor',
			icon: 'icon-display',
		},
		conditions: [
			{
				alias: 'Umb.Condition.WorkspaceAlias',
				match: 'Umb.Workspace.Document',
			},
		],
	},
];
