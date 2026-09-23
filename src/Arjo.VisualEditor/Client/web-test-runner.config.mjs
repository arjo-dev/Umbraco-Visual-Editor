import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

// Unit tests run in real Chromium (iframes, postMessage and MessageChannel behave as in the browser).
// Tests that need Umbraco's own packages can add an import map as described in the umbraco-unit-testing skill.
export default {
	rootDir: '.',
	files: ['src/**/*.test.ts'],
	nodeResolve: true,
	browsers: [playwrightLauncher({ product: 'chromium' })],
	plugins: [esbuildPlugin({ ts: true, tsconfig: './tsconfig.json', target: 'auto' })],
	testFramework: {
		config: { timeout: 5000 },
	},
};
