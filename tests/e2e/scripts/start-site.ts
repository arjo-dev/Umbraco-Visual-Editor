/**
 * `npm run site` (or `npm run site:compat`): starts a throwaway copy of the Test Site (or the Compat Site, #38; see
 * site.ts) and keeps it running, so the tests can be run against it again and again without a fresh install each time.
 * Prints the variables to run them with.
 */
import { spawn, spawnSync } from 'node:child_process';
import { DEFAULT_LOGIN, newPassword, newRunDir, SITES, throwawaySite, type SiteName } from '../site.ts';

const name = (process.env.E2E_SITE ?? 'test') as SiteName;
const url = `https://localhost:${SITES[name].port}`;
const password = newPassword();
const runDir = newRunDir();
const site = throwawaySite(name, url, DEFAULT_LOGIN, password, runDir);

console.log(`Starting a throwaway copy of the ${name} site at ${url} (data in ${runDir}).`);
console.log('Once it has started, run the tests against it from another terminal with:');
console.log(`  URL=${url} UMBRACO_USER_PASSWORD='${password}' npm ${name === 'compat' ? 'run test:compat' : 'test'}`);

const child = spawn(site.command, {
	cwd: site.cwd,
	env: { ...process.env, ...site.env },
	shell: true,
	stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));

// Stopping this script stops the site too: `dotnet run` starts the site as a process of its own.
const stop = () => {
	if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
	else child.kill('SIGTERM');
	process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
