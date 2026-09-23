export const manifests: Array<UmbExtensionManifest> = [
	{
		type: 'workspaceView',
		alias: 'Arjo.VisualEditor.WorkspaceView.Preview',
		name: 'Arjo Visual Editor Preview Workspace View',
		element: () => import('./visual-preview-workspace-view.element.js'),
		weight: 500,
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
