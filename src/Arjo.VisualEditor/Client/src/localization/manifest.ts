export const manifests: Array<UmbExtensionManifest> = [
	{
		type: 'localization',
		alias: 'Arjo.VisualEditor.Localization.En',
		name: 'Arjo Visual Editor English',
		meta: { culture: 'en' },
		js: () => import('./en.js'),
	},
];
