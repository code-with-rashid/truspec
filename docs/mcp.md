# AI agents (MCP)

TruSpec is **agent-native by design**: every capability is reachable through plain files,
the `--json` CLI, *and* a first-party [Model Context Protocol](https://modelcontextprotocol.io)
server. The MCP server lets agents like Claude Code, Cursor, and any other MCP client
author, run, and sync collections directly — with the same engine and the same validation
guarantees as the CLI.

Package: [`@truspec/mcp-server`](https://www.npmjs.com/package/@truspec/mcp-server).

---

## Install

### Claude Code

```bash
# published (recommended):
claude mcp add truspec -- npx -y @truspec/mcp-server

# or from a source checkout, after `pnpm build`:
claude mcp add truspec -- node ./packages/mcp-server/dist/index.js
```

### Any MCP client

Add the server to your client's config:

```json
{
  "mcpServers": {
    "truspec": { "command": "npx", "args": ["-y", "@truspec/mcp-server"] }
  }
}
```

The server communicates over stdio and operates relative to the working directory it's
launched in — that directory is the [workspace](./concepts.md#the-workspace) it discovers
collections, environments, and folder config from.

---

## Tools

The server exposes **11 tools** over the official MCP SDK. Tools that create or update
files **validate against the schema before writing**, so an agent can't land a malformed
`.tspec.yaml` in your repo.

| Tool | Inputs | What it does |
|---|---|---|
| `truspec_list_collections` | `dir?` (default `.`) | List requests under a directory: name, method, URL, linked operation, assertion count. |
| `truspec_run_request` | `path`, `env?` | Run one `.tspec.yaml`; returns status, timing, body, and assertion results. |
| `truspec_run_collection` | `dir`, `env?` | Run every request in a directory; returns aggregate pass/fail plus per-request results. |
| `truspec_create_request` | `path`, `request` | Create a request file from a request object (validated first). |
| `truspec_update_request` | `path`, `patch` | Merge a partial patch into an existing request (validated first). |
| `truspec_drift` | `dir`, `spec`, `live?` | Diff a collection against an OpenAPI spec; optionally probe a live API. |
| `truspec_coverage` | `dir`, `spec`, `min?` | Report which spec operations are exercised by a request with assertions. |
| `truspec_contract` | `dir`, `spec`, `env?` | Run the collection and validate each response against the spec's response schema. |
| `truspec_scaffold_from_spec` | `spec`, `out`, `baseUrlVar?` | Generate a request stub per operation (closes drift gaps). |
| `truspec_mock_start` | `spec`, `port?`, `delay?`, `validate?` | Start a local mock server from a spec. |
| `truspec_mock_stop` | — | Stop the running mock server, if any. |

Notes:

- **Writes are confined to the workspace.** `create`/`update`/`scaffold` resolve and
  confine paths so an agent can't write outside the directory the server was launched in
  (symlinks are followed and checked).
- **The mock is stateful per server instance.** `truspec_mock_start` runs one mock at a
  time; calling it again while one is running reports the existing URL. Omit `port` to get
  an ephemeral free port. `truspec_mock_stop` tears it down.
- All tools return JSON, identical in shape to the corresponding `--json` CLI output.

---

## What an agent can do

Because every tool maps to a real engine capability, an agent can run an entire workflow
end-to-end:

> *"Here's our `openapi.yaml`. Scaffold a collection, start a mock, run it, and tell me what's
> not covered."*

1. `truspec_scaffold_from_spec` → stubs for every operation.
2. `truspec_mock_start` → an offline API to run against.
3. `truspec_run_collection` → execute and report.
4. `truspec_coverage` / `truspec_drift` / `truspec_contract` → find the gaps: untested,
   drifted, and responses that violate the spec's schema.
5. `truspec_create_request` / `truspec_update_request` → fill them in (validated on write).
6. `truspec_mock_stop` → clean up.

The agent never touches a GUI and never needs network access beyond your own API — the same
properties that make TruSpec good for humans make it good for agents.

---

## Authoring tips for agents

If you're driving TruSpec from an agent (or writing the prompt/instructions for one):

- **Validate before writing.** Prefer `truspec_create_request` / `truspec_update_request`
  over raw file writes — they run the schema and reject unknown keys, so typos surface
  immediately.
- **Reference secrets by name**, never inline them — see
  [Environments](./file-format.md#environment-files).
- **Keep one request per file** and stable key order for clean diffs.
- The repository's [`CLAUDE.md`](https://github.com/code-with-rashid/truspec/blob/main/CLAUDE.md) is a ready-made instruction file for coding
  agents working in a TruSpec repo.

---

## See also

- **[Core concepts](./concepts.md)** — the workspace and validation model the tools share.
- **[File format](./file-format.md)** — the shape of the `request` object tools accept.
- **[Spec sync](./spec-sync.md)** & **[Mock server](./mocking.md)** — the engine features
  behind the tools.
