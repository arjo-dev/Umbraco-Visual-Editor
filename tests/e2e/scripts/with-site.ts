/**
 * `node scripts/with-site.ts <site> <command...>`: runs the command with E2E_SITE set, on any OS (npm scripts can't set
 * an environment variable the same way on Windows and Linux). Used by `npm run test:compat` and `npm run site:compat`.
 */
import { spawnSync } from 'node:child_process';

const [site, ...command] = process.argv.slice(2);
const result = spawnSync(command.join(' '), {
	env: { ...process.env, E2E_SITE: site },
	shell: true,
	stdio: 'inherit',
});
process.exit(result.status ?? 1);
