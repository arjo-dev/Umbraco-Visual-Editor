export const manifests: Array<UmbExtensionManifest> = [
	{
		name: 'Arjo Visual Editor Entrypoint',
		alias: 'Arjo.VisualEditor.Entrypoint',
		type: 'backofficeEntryPoint',
		js: () => import('./entrypoint.js'),
	},
];
