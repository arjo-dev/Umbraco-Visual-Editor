# End-to-end tests

These use Playwright to run the Visual editor in a real backoffice, against the Test Site's Visual Editor Playground page (#37). They use [`@umbraco-cms/acceptance-test-helpers`](https://www.npmjs.com/package/@umbraco-cms/acceptance-test-helpers) for signing in and for Umbraco's own UI, and plain Playwright for the Visual editor.

`specs/visual-editor.spec.ts` covers the core flows:
- switching into visual mode;
- editing the title in place;
- changing a picker in the side panel;
- reordering blocks;
- adding a block;
- switching back to the standard editor with the changes intact;
- saving and publishing.

`specs/compat/compat.spec.ts` runs against the **Compat Site** (#38): plain Umbraco with compiled models, hand-rolled block loops, a view component, a cached partial and output caching. See [docs/compatibility.md](../../docs/compatibility.md). Run it with `npm run test:compat`, and keep one running with `npm run site:compat`.

## Running them

```bash
npm ci
npx playwright install chromium
npm test
```

`npm test` starts a **throwaway Test Site** on https://localhost:44610 and stops it afterwards (`site.ts`). The throwaway site:

- is a fresh install, with its own database, temp, log and media folders in the OS temp directory;
- gets a new admin password for each run;
- never touches your development database;
- imports the committed uSync files and never writes them (export-on-save is off);
- is a Release build that doesn't read `appsettings.Local.json`;
- runs happily beside a Test Site you already have running.

Its content is the **committed** uSync files (`HEAD`), the same content CI tests. Edits in your working tree (for example exports from testing by hand) aren't imported, and the throwaway site never writes the uSync files.

**Writing tests:** a fresh install takes about a minute. To run the tests over and over against one site:

```bash
npm run site                # keeps a throwaway site running; prints the command below
URL=https://localhost:44610 UMBRACO_USER_PASSWORD='…' npm test
```

Other useful commands:
- `npm run test:ui` opens Playwright's UI mode.
- `npx playwright show-report` shows the last run, with traces of any failures.

**Against another site:** set `URL`, `UMBRACO_USER_LOGIN` and `UMBRACO_USER_PASSWORD`. CI does this, using the fresh site it has already started and checked. The tests save and publish the Playground page, so don't point them at a site whose content matters.
