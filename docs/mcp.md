# Umbraco MCP server

The repo configures the [Umbraco Developer MCP server](https://github.com/umbraco/Umbraco-CMS-MCP-Dev) (`@umbraco-cms/mcp-dev`, v18 line) in [`.mcp.json`](../.mcp.json). It gives Claude Code access to the Test Site through the Management API. For example, Claude can inspect document types and content, check which extension manifests are registered, and read the logs.

It authenticates as an Umbraco **API user**, so it can only do what that user's groups allow.

## Setup

1. Set a client secret for the Test Site. In Development, the site creates the API user `mcp@example.com` (in the Administrators group) with client ID `umbraco-back-office-mcp` when it starts:
   ```bash
   cd "Umbraco Visual Editor.Test Site"
   dotnet user-secrets set "TestSite:ApiUser:ClientSecret" "<secret>"
   ```
   See [development.md](development.md) for the rest of the first-run setup.
2. Copy `.env.mcp.example` to `.env.mcp` and set `UMBRACO_CLIENT_SECRET` to the same secret. `.env.mcp` is gitignored.
3. Run the Test Site, then restart Claude Code. The `umbraco` server is pre-approved in `.claude/settings.json`.

If the site was installed before this setup existed, it creates the user on its next start. You can also add client credentials to any API user yourself: go to Users, open the API user, and choose **Add client credentials**. The client ID must start with `umbraco-back-office-`.

## Configuration

Settings that aren't secret live in `.mcp.json`. Values in `.env.mcp` override them.

| Variable | Default | Notes |
|---|---|---|
| `UMBRACO_BASE_URL` | `https://localhost:44394` | Test Site HTTPS URL |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `0` | Accepts the local dev certificate. Local use only. |
| `UMBRACO_TOOL_MODES` | `content,content-modeling,front-end,media,translation,system,health` | Groups of tool collections. `users`, `members` and `search` are left out. |
| `UMBRACO_READONLY` | unset | Set to `true` to disable all write tools. |

The Test Site must be running for the server's tools to work.

`.mcp.json` launches the server with `cmd /c npx` because Windows needs that. On macOS or Linux, change the command to `npx` locally.
