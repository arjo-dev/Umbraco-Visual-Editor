import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The Test Site project. */
export const SITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../Umbraco Visual Editor.Test Site');

/**
 * A throwaway Test Site (#37): a fresh install, with a database, temp, log and media folders of its own in `runDir`,
 * signed in to with a password made up for it. It imports the uSync files, never writes them (export-on-save is off),
 * never touches the development database, and runs beside a Test Site you already have running (its own MainDom and
 * temp). Release, so it's a separate build from the one a dev site runs, without appsettings.Local.json.
 */
export function throwawaySite(url: string, login: string, password: string, runDir: string) {
	mkdirSync(join(runDir, 'temp'), { recursive: true });
	return {
		command: 'dotnet run -c Release --no-launch-profile',
		cwd: SITE_DIR,
		env: {
			ASPNETCORE_ENVIRONMENT: 'Development',
			ASPNETCORE_URLS: url,
			ConnectionStrings__umbracoDbDSN: `Data Source=${join(runDir, 'Umbraco.sqlite.db')};Cache=Shared;Foreign Keys=True;Pooling=True`,
			ConnectionStrings__umbracoDbDSN_ProviderName: 'Microsoft.Data.Sqlite',
			Umbraco__CMS__Unattended__InstallUnattended: 'true',
			Umbraco__CMS__Unattended__UnattendedUserEmail: login,
			Umbraco__CMS__Unattended__UnattendedUserPassword: password,
			Umbraco__CMS__Hosting__LocalTempStorageLocation: 'EnvironmentTemp',
			TEMP: join(runDir, 'temp'),
			TMP: join(runDir, 'temp'),
			Umbraco__CMS__Logging__Directory: join(runDir, 'logs'),
			Umbraco__CMS__Global__UmbracoMediaPhysicalRootPath: join(runDir, 'media'),
			Umbraco__CMS__Global__MainDomKeyDiscriminator: 'arjo-visual-editor-e2e',
			uSync__Settings__ExportOnSave: 'None',
		} as Record<string, string>,
	};
}

export const DEFAULT_PORT = '44610';
export const DEFAULT_LOGIN = 'admin@example.com';
export const newPassword = () => `E2e-${randomBytes(18).toString('base64url')}`;
const RUNS_DIR = join(tmpdir(), 'arjo-visual-editor-e2e');

/**
 * A folder for a new throwaway site. Older runs' folders are cleared out, keeping the latest (its logs may explain a
 * failure); one still in use by a running site can't be deleted, and is left alone.
 */
export function newRunDir() {
	mkdirSync(RUNS_DIR, { recursive: true });
	const previous = readdirSync(RUNS_DIR, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name);
	for (const name of previous.sort().slice(0, -1)) {
		try {
			rmSync(join(RUNS_DIR, name), { recursive: true, force: true });
		} catch {
			// In use.
		}
	}
	return join(RUNS_DIR, String(Date.now()));
}
