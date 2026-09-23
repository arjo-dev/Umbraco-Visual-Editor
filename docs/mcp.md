# Umbraco MCP server

The repo configures the [Umbraco Developer MCP server](https://github.com/umbraco/Umbraco-CMS-MCP-Dev) (`@umbraco-cms/mcp-dev`, v18 line) in [`.mcp.json`](../.mcp.json). It gives Claude Code access to the Test Site through the Management API. For example, Claude can inspect document types and content, check which extension manifests are registered, and read the logs.

It authenticates as an Umbraco **API user**, so it can only do what that user's groups allow.

## One-time setup

1. Run the Test Site (`https://localhost:44394`) and log in to the backoffice.
2. Go to **Users → Create → API User**. Name it `MCP` and add it to the **Administrators** group. This is fine for the local test site. Use a narrower group anywhere else.
3. Open the user, choose **Add client credentials**, and set:
   - **Client ID:** `umbraco-back-office-mcp` (Umbraco requires the `umbraco-back-office-` prefix)
   - **Client secret:** any strong value
4. Copy `.env.mcp.example` to `.env.mcp` and fill in the client ID and client secret. `.env.mcp` is gitignored.
5. Restart Claude Code. The `umbraco` server is pre-approved in `.claude/settings.json`.

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
