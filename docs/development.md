# Local development

## Prerequisites

- .NET SDK 10
- Node.js 24 or later

## First run

```bash
cd "Umbraco Visual Editor.Test Site"
dotnet user-secrets set "Umbraco:CMS:Unattended:UnattendedUserPassword" "<choose a password>"
dotnet user-secrets set "TestSite:ApiUser:ClientSecret" "<choose a client secret>"
dotnet run --launch-profile Umbraco.Web.UI
```

The site runs at `https://localhost:44394`, and the backoffice is at `/umbraco`. Log in as `admin@example.com` with the password you set above.

The admin password setting is required on **every** start, not just the first. Umbraco validates the unattended settings each time and won't boot if the name and email are set without a password. User secrets persist, so you only set it once.

On first boot, with no database, the site:

1. **Installs Umbraco without prompting**, into SQLite at `umbraco/Data/Umbraco.sqlite.db`. The admin account comes from `appsettings.Development.json` plus your user secret.
2. **Runs the Clean starter kit's package migration**, which adds its media files and default setup.
3. **Imports everything in `uSync/v18`**: languages, document types, data types, templates, media, dictionary items, content and domains.
4. **Creates the API user** used by the [Umbraco MCP server](mcp.md), if `TestSite:ApiUser:ClientSecret` is set.

To start again from scratch, stop the site and delete `umbraco/Data`.

On that first boot only, uSync's export-on-save is switched off (see `Program.cs`). Otherwise Clean's migration would overwrite the committed uSync files before they're imported. Restart the site once before you edit content that you want exported.

The passwords and secrets above can also be supplied as environment variables, which is what CI uses:

| Setting | Environment variable |
|---|---|
| Admin password | `Umbraco__CMS__Unattended__UnattendedUserPassword` |
| API client secret | `TestSite__ApiUser__ClientSecret` |

## Extension development

`dotnet build` also builds the extension's client code in `src/Arjo.VisualEditor/Client`. For hot reload while editing TypeScript:

```bash
cd src/Arjo.VisualEditor/Client
npm run watch
```

Pass `-p:SkipClientBuild=true` to `dotnet build`/`dotnet run` so the two builds don't overlap.

Other client scripts: `npm run lint`, `npm run format`, `npm run check` (type-check), and `npm run generate-client` (regenerates the API client from the running site).

## Test content

The site is the [Clean starter kit](https://github.com/prjseal/Clean-Starter-Kit-for-Umbraco) plus a **Visual Editor Playground** page. The playground is served at `/playground/` in English and `/da/legeplads/` in Danish.

| Case | Where |
|---|---|
| Text, text area | Playground `title`, `subtitle` (vary by culture) |
| Rich text | Playground `body`, and the Rich Text Row blocks |
| Media picker | Playground `heroImage` (shared across languages), and the Image Row blocks |
| Single Block | Playground `hero` (`[SingleBlock] Playground Hero`) |
| Block List | Playground `blocks` (Clean's `[BlockList] Main Content`), and Clean's `contentRows` on most pages |
| Block Grid, nested areas | Playground `grid` (`[BlockGrid] Playground`): a two-column layout block with `left`/`right` areas |
| Culture variants | Languages `en-US` (default) and `da-DK`. Home has the domains `/` (en-US) and `/da` (da-DK). |
| Properties not shown on the page | Playground's SEO and Visibility compositions |

## Changing the schema or content

uSync writes each item you save in the backoffice to `uSync/v18`. Commit those files along with your change. Run a full export from the uSync dashboard (Settings → uSync) if something is missing.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request and on pushes to `main`. It:

1. Installs, lints, format-checks, type-checks and builds the client.
2. Builds the solution with `dotnet build` and runs `dotnet test`.
3. Runs a smoke test: installs the Test Site from scratch, with throwaway credentials, and checks that:
   - the home page and both playground variants render;
   - the dev API user can get a token;
   - the Management API lists the `Arjo.VisualEditor` manifest;
   - the first boot left the working tree unchanged.

If the smoke test fails, the site log is uploaded as the `test-site-log` artifact.

Client sources are kept LF (see `.gitattributes`), so `npm run format:check` behaves the same on Windows as in CI.
