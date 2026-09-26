import { defineConfig, devices } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOGIN, newPassword, newRunDir, SITES, throwawaySite, type SiteName } from './site.ts';

/**
 * End-to-end tests for the Visual editor in a real backoffice (#37). See README.md.
 *
 * - `E2E_SITE` picks the site: `test` (the default: the Test Site, specs/) or `compat` (the Compat Site, #38,
 *   specs/compat/).
 * - With `URL` set (CI, or `npm run site`), they run against that site, signed in as UMBRACO_USER_LOGIN /
 *   UMBRACO_USER_PASSWORD. Without it, they start a throwaway copy of the site (site.ts) and stop it afterwards.
 *
 * The config is evaluated again in each worker: values made up here are kept in the environment so they stay the same.
 */
const site = (process.env.E2E_SITE ?? 'test') as SiteName;
if (!(site in SITES)) throw new Error(`E2E_SITE must be one of: ${Object.keys(SITES).join(', ')}`);
const external = !!process.env.URL;
process.env.URL ??= `https://localhost:${SITES[site].port}`;
process.env.UMBRACO_USER_LOGIN ??= DEFAULT_LOGIN;
process.env.UMBRACO_USER_PASSWORD ??= newPassword();
process.env.E2E_RUN_DIR ??= newRunDir();

/** The signed-in session the tests share (the helpers read it from STORAGE_STATE_PATH). */
export const STORAGE_STATE = join(dirname(fileURLToPath(import.meta.url)), '.auth', `${site}.json`);
process.env.STORAGE_STATE_PATH = STORAGE_STATE;

export default defineConfig({
	testDir: site === 'compat' ? './specs/compat' : './specs',
	testIgnore: site === 'compat' ? undefined : '**/compat/**',
	// The first backoffice load and render sessions on a cold site are slow.
	timeout: 90_000,
	expect: { timeout: 15_000 },
	// The specs share one document per site, so they run one after another.
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: [
		[process.env.CI ? 'line' : 'list'],
		['html', { open: 'never', outputFolder: `playwright-report/${site}` }],
	],
	outputDir: `test-results/${site}`,
	use: {
		baseURL: process.env.URL,
		ignoreHTTPSErrors: true,
		// Umbraco marks its elements with data-mark, not data-testid.
		testIdAttribute: 'data-mark',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'setup', testDir: './specs', testMatch: /auth\.setup\.ts/ },
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
					site,
					process.env.URL,
					process.env.UMBRACO_USER_LOGIN,
					process.env.UMBRACO_USER_PASSWORD,
					process.env.E2E_RUN_DIR,
				),
				// Up once its content is there: the Test Site's Playground (imported by uSync on first boot) renders, or the
				// Compat Site says its page is published (it's created on first boot; see the site's Program.cs).
				url: `${process.env.URL}${site === 'compat' ? '/compat-ready' : '/playground/'}`,
				ignoreHTTPSErrors: true,
				reuseExistingServer: false,
				timeout: 600_000,
				stdout: 'ignore',
				stderr: 'pipe',
			},
});
