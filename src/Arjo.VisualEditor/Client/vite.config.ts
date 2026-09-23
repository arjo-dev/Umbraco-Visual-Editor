import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		lib: {
			entry: {
				// Backoffice bundle: registers the extension's manifests.
				'arjo-visual-editor': 'src/bundle.manifests.ts',
				// Loaded inside rendered pages (render sessions), not the backoffice.
				'canvas-debug': 'src/canvas/debug.ts',
			},
			formats: ['es'],
			fileName: (_format, entryName) => `${entryName}.js`,
		},
		outDir: '../wwwroot/App_Plugins/ArjoVisualEditor', // your web component will be saved in this location
		emptyOutDir: true,
		sourcemap: true,
		rollupOptions: {
			external: [/^@umbraco/],
		},
	},
});
