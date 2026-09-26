import { defineConfig, devices } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOGIN, DEFAULT_PORT, newPassword, newRunDir, throwawaySite } from './site.ts';

/**
 * End-to-end tests for the Visual editor in a real backoffice (#37). See README.md.
 *
 * - With `URL` set (CI, or `npm run site`), they run against that site, signed in as UMBRACO_USER_LOGIN /
 *   UMBRACO_USER_PASSWORD.
 * - Without it, they start a throwaway Test Site of their own (site.ts) and stop it afterwards.
 *
 * The config is evaluated again in each worker: values made up here are kept in the environment so they stay the same.
 */
const external = !!process.env.URL;
process.env.URL ??= `https://localhost:${DEFAULT_PORT}`;
process.env.UMBRACO_USER_LOGIN ??= DEFAULT_LOGIN;
process.env.UMBRACO_USER_PASSWORD ??= newPassword();
process.env.E2E_RUN_DIR ??= newRunDir();

/** The signed-in session the tests share (the helpers read it from STORAGE_STATE_PATH). */
export const STORAGE_STATE = join(dirname(fileURLToPath(import.meta.url)), '.auth', 'user.json');
process.env.STORAGE_STATE_PATH = STORAGE_STATE;

export default defineConfig({
	testDir: './specs',
	// The first backoffice load and render sessions on a cold site are slow.
	timeout: 90_000,
	expect: { timeout: 15_000 },
	// The specs share one Playground document, so they run one after another.
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: [[process.env.CI ? 'line' : 'list'], ['html', { open: 'never' }]],
	use: {
		baseURL: process.env.URL,
		ignoreHTTPSErrors: true,
		// Umbraco marks its elements with data-mark, not data-testid.
		testIdAttribute: 'data-mark',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'setup', testMatch: /auth\.setup\.ts/ },
		{
			name: 'visual-editor',
			dependencies: ['setup'],
			use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 }, storageState: STORAGE_STATE },
		},
	],
	webServer: external
		? undefined
		: {
				...throwawaySite(
					process.env.URL,
					process.env.UMBRACO_USER_LOGIN,
					process.env.UMBRACO_USER_PASSWORD,
					process.env.E2E_RUN_DIR,
				),
				// Up once the Playground page (imported by uSync on first boot) renders.
				url: `${process.env.URL}/playground/`,
				ignoreHTTPSErrors: true,
				reuseExistingServer: false,
				timeout: 600_000,
				stdout: 'ignore',
				stderr: 'pipe',
			},
});
