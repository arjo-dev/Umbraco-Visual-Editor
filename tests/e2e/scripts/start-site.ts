/**
 * `npm run site`: starts a throwaway Test Site (see site.ts) and keeps it running, so the tests can be run against it
 * again and again without a fresh install each time. Prints the variables to run them with.
 */
import { spawn, spawnSync } from 'node:child_process';
import { DEFAULT_LOGIN, DEFAULT_PORT, newPassword, newRunDir, throwawaySite } from '../site.ts';

const url = `https://localhost:${process.env.E2E_PORT ?? DEFAULT_PORT}`;
const password = newPassword();
const runDir = newRunDir();
const site = throwawaySite(url, DEFAULT_LOGIN, password, runDir);

console.log(`Starting a throwaway Test Site at ${url} (data in ${runDir}).`);
console.log('Once /playground/ loads, run the tests against it from another terminal with:');
console.log(`  URL=${url} UMBRACO_USER_PASSWORD='${password}' npm test`);

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
