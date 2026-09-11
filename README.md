# TruSpec

> **Local-first, spec-synced, agent-native API client.**
> Your API collection is plain text — your coding agent *and* your CI both read it, run it, and keep it in sync with your OpenAPI spec. Fully offline. No account, ever.

[![CI](https://github.com/code-with-rashid/truspec/actions/workflows/ci.yml/badge.svg)](https://github.com/code-with-rashid/truspec/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
![status: alpha](https://img.shields.io/badge/status-alpha-orange)

📚 **[Read the documentation →](https://code-with-rashid.github.io/truspec/)** — getting started, file format, CLI, spec sync, CI, MCP, and the programmatic API.

---

## Why TruSpec

The API-client market runs from **local-and-minimal** (Bruno) to **cloud-and-everything** (Postman). TruSpec owns the unclaimed intersection: **an integrated engine where your OpenAPI spec is the source of truth, your collection is plain text, and an AI agent or CI pipeline can run it and fail the build the moment your code drifts from the spec — entirely offline.**

| | Postman | Bruno | TruSpec |
|---|:---:|:---:|:---:|
| Local files + Git source of truth | ✗ | ✓ | ✓ |
| Fully offline, no account | ✗ | ✓ | ✓ |
| Open source (MIT) | ✗ | ✓ | ✓ |
| OpenAPI **drift detection** (CI gate) | ✗ | basic | ✓ |
| OpenAPI **coverage** report | ✗ | ✗ | ✓ |
| OpenAPI **response contract** validation | ✗ | ✗ | ✓ |
| Local **mock server** (no cloud) | cloud | ✗ | ✓ |
| **Collection linter** (inline secrets, dead assertions) | ✗ | ✗ | ✓ |
| **Committable Markdown docs** from the collection | cloud | ✗ | ✓ |
| First-party **MCP server** for agents | bolted-on | community | ✓ |
| Import from Postman + Bruno + Insomnia + curl + HAR | — | partial | ✓ |
| Code generation (17 clients/langs) | ✓ | ✓ | ✓ |

## Quickstart

Install the CLI (Node ≥ 22):

```bash
npm i -g truspec        # global `truspec` command — or run any command with `npx truspec …`
truspec --help
```

> **Hacking on TruSpec itself?** Run from source instead: `git clone https://github.com/code-with-rashid/truspec && cd truspec`, then `pnpm install && pnpm build` — now `node packages/cli/dist/index.js` is the `truspec` binary.

A collection is a folder of plain-text YAML files that diff cleanly and live in your repo:

```yaml
# api/get-pet.tspec.yaml
name: Get pet by id
method: GET
url: "{{baseUrl}}/pets/{{petId}}"
assertions:
  - { type: status, equals: 200 }
  - { type: jsonpath, path: "$.id", exists: true }
spec:
  operation: "GET /pets/{id}"   # links back to your OpenAPI spec
```

`truspec init` scaffolds exactly that — a request, an environment, and a `.gitignore` — in an empty folder.

See the [blog](./examples/blog/API.md) and [petstore](./examples/petstore/API.md) example
collections rendered by `truspec docs` — those files are regenerated and diffed in CI, so they are
never out of date with the collections they describe.

**Try it now** — clone the repo for a ready-made collection + OpenAPI spec and run the whole loop offline. These commands work as-is (no placeholders to fill in):

```bash
git clone https://github.com/code-with-rashid/truspec
cd truspec
truspec mock examples/blog/openapi.yaml &
truspec run examples/blog --env local
truspec drift examples/blog --spec examples/blog/openapi.yaml
truspec coverage examples/blog --spec examples/blog/openapi.yaml
```

You should see `run` report **3 passing** requests against the mock, `drift` flag **`GET /users/{id}`** as untracked, and `coverage` show **75% (3/4)**. (Two examples ship in [`examples/`](./examples): `petstore` and a fuller `blog`.)

## The commands

Point these at **your own** collection — a folder of `.tspec.yaml` files — plus your OpenAPI spec. Replace the `<…>` placeholders:

**Start a collection**

- `truspec init [<dir>]` — scaffold a runnable collection (request + environment + `.gitignore`)
- `truspec gen <openapi.yaml> --out <dir>` — scaffold a request stub per spec operation
- `truspec import <postman|bruno|insomnia|curl|har> <path> --out <dir>` — migrate what you already have

**Run it**

- `truspec run <dir> --env <name>` — run requests + assertions; non-zero exit on failure
- `truspec run <dir> --data <file>` — data-driven runs: one iteration per row of a CSV or JSON dataset
- `truspec run <dir> --repeat <n>` — run the selection n times (load smoke, flake hunting)
- `truspec run <dir> --watch` — re-run on file change while you edit
- `truspec run <dir> --reporter <human|json|junit|html>` — human by default, machine formats for CI

**Keep it honest against the spec**

- `truspec drift --spec <openapi.yaml> <dir> [--live <baseUrl>]` — fail CI on drift vs the spec (and a live API)
- `truspec coverage --spec <openapi.yaml> <dir> --min 80` — gate on tested-operation coverage
- `truspec contract --spec <openapi.yaml> <dir> --env <name>` — run + validate responses against the spec's schemas
- `truspec mock <openapi.yaml> --port 4000` — offline mock server from your spec

**Work with it day to day**

- `truspec lint <dir> --strict` — 13 static checks (inline secrets, dead assertions, undeclared vars, …)
- `truspec docs <dir> --out API.md` — render the collection as committable Markdown
- `truspec env [--diff <a> <b>]` — list, inspect, and diff environments (never prints secret values)
- `truspec codegen <request> --lang <target>` — a runnable snippet in any of 17 clients/languages
- `truspec export postman <dir>` — hand the collection to someone who works in Postman
- `truspec serve <dir>` — open the local web UI

The reporting commands — `run`, `drift`, `coverage`, `contract`, `lint`, `env` — all speak `--json`
for machines, and every command exits non-zero on failure, so they drop straight into CI.

**Chaining:** a request can `capture` a value for later requests in the same run (ordered by `order`) — e.g. log in, capture the token, use it downstream. No scripting required:

```yaml
# 01-login.tspec.yaml →  order: 1,  capture: { token: "$.access_token" }
# 02-me.tspec.yaml    →  order: 2,  auth: { type: bearer, token: "{{token}}" }
```

## The GUI

`truspec serve <dir>` opens a local web UI over the same engine — and it reads *and writes* the same
plain-text files, so anything you do in it lands as a clean diff in your repo:

- **Edit requests visually** — URL, headers, query, body, auth, assertions, capture, scripts, tags, and options, with variable-aware inputs
- **Manage the tree** — create, rename, duplicate, and delete requests and folders; edit folder defaults and environments
- **Run and inspect** — single requests or the whole collection, with response body, timings, assertion results, and script logs
- **Flow view** — visualize and run request chains as a graph, so a capture-and-reuse sequence is something you can see
- **Import and export** — pull in Postman/Bruno/Insomnia/curl/HAR, push back out to Postman, or copy a request as a snippet
- **Drift, coverage, and the mock server** — the spec-sync loop and a mock with a live request log, without leaving the UI
- **Keyboard-first** — a command palette (and a shortcuts reference) for everything above

### Download the desktop app

Prefer a GUI over the CLI, without a Node install? **TruSpec Desktop** is a native app (built with Tauri) that wraps the same UI in an installable window.

Grab the installer for your OS from **[the latest release](https://github.com/code-with-rashid/truspec/releases/latest)**:

- **Windows** — `TruSpec_<version>_x64-setup.exe` (or the `.msi`)
- **macOS** — `TruSpec_<version>_aarch64.dmg` (Apple Silicon; runs on Intel Macs too, under Rosetta 2)
- **Linux** — `.AppImage`, `.deb`, or `.rpm`

These are **unsigned** builds for now (no code-signing cert or Apple notarization yet), so your OS will warn on first launch:

- **Windows**: SmartScreen shows "unknown publisher" — click **More info → Run anyway**.
- **macOS**: Gatekeeper quarantines the download — run `xattr -cr /Applications/TruSpec.app` once, then open it.
- **Linux**: no equivalent warning.

## Use it from an AI agent (MCP)

TruSpec ships a first-party [MCP](https://modelcontextprotocol.io) server so agents like Claude Code can author, run, and sync collections directly.

```bash
# published (recommended):
claude mcp add truspec -- npx -y @truspec/mcp-server

# or from a source checkout, after `pnpm build`:
claude mcp add truspec -- node ./packages/mcp-server/dist/index.js
```

Or add it to your MCP client config:

```json
{
  "mcpServers": {
    "truspec": { "command": "npx", "args": ["-y", "@truspec/mcp-server"] }
  }
}
```

**23 tools**, grouped by what an agent is trying to do:

| | Tools |
|---|---|
| **Author** | `list_collections` · `read_request` · `create_request` · `update_request` · `delete_request` · `validate_request` · `format_reference` |
| **Run** | `run_request` · `run_collection` · `environments` |
| **Sync with the spec** | `drift` · `coverage` · `contract` · `scaffold_from_spec` |
| **Mock** | `mock_start` · `mock_stop` |
| **Inspect** | `lint` · `docs` |
| **Generate** | `codegen` · `codegen_targets` |
| **Import** | `import_curl` · `import_har` · `import_insomnia` |

(Each is prefixed `truspec_` — e.g. `truspec_run_collection`.) Write operations validate against the
schema before touching disk, and `format_reference` lets an agent look the format up rather than
guess at it.

## How it fits together

```
@truspec/core — the engine (pure TS; no platform deps in the browser-safe entry)
  ├─ format      parse / serialize / validate  (+ the published JSON Schema)
  ├─ runner      interpolation, auth, fetch, declarative assertions, scripts
  ├─ workspace   discovery, folder inheritance, env + secret resolution
  ├─ spec        OpenAPI drift, coverage, response-contract validation
  ├─ importers   Postman · Bruno · Insomnia · curl · HAR  →  .tspec.yaml
  ├─ exporters   collection  →  Postman v2.1
  ├─ codegen     request  →  a runnable snippet in 17 clients/languages
  ├─ lint        13 static checks over a collection
  ├─ docs        collection  →  deterministic Markdown
  ├─ mock        local mock server generated from a spec
  ├─ jsonpath    the JSONPath subset used by assertions and capture
  └─ http        shared server lifecycle (a shutdown that always terminates)

truspec              — the CLI (14 commands: init · run · drift · coverage · contract · gen ·
                       codegen · lint · docs · env · import · export · mock · serve)
@truspec/mcp-server  — the agent surface (23 MCP tools)
@truspec/web         — the web UI + local server (truspec serve)
@truspec/desktop     — the Tauri shell around that UI
truspec-vscode       — the editor extension (CodeLens + results view)
```

Each core module is a subpath import — `@truspec/core/runner`, `/spec`, `/lint`, and so on. The
filesystem and server modules (`workspace`, `spec`, `importers`, `mock`, `http`) are deliberately
kept out of the browser-safe main entry.

## Documentation

Full documentation lives in [`docs/`](./docs/README.md):

| | |
|---|---|
| [Getting started](./docs/getting-started.md) · [Core concepts](./docs/concepts.md) | install, the example loop, and the mental model |
| [File format](./docs/file-format.md) · [CLI](./docs/cli.md) · [Programmatic API](./docs/api.md) | the complete references |
| [Spec sync](./docs/spec-sync.md) · [Mock server](./docs/mocking.md) · [Importing](./docs/importing.md) | drift & coverage, offline mocks, Postman/Bruno migration |
| [Scripting](./docs/scripting.md) · [CI/CD](./docs/ci.md) · [AI agents (MCP)](./docs/mcp.md) · [Editors](./docs/editors.md) | the advanced surfaces |
| [FAQ & troubleshooting](./docs/faq.md) | common questions and error fixes |

## File format

One request per file (`*.tspec.yaml`), folder config (`folder.tspec.yaml`) for shared base URL/auth/headers, and environments (`environments/*.env.yaml`) where **secrets are referenced by name, never inlined**. The Zod schema in `packages/core/src/format/schema.ts` is the source of truth; a JSON Schema is generated to `packages/core/schema/` for editors and agents. See the [file format reference](./docs/file-format.md) for the full guide (or [`CLAUDE.md`](./CLAUDE.md) for the agent-oriented summary).

## Development

```bash
pnpm test            # vitest
pnpm test:coverage   # v8 coverage
pnpm typecheck
pnpm build
pnpm gen:schema      # regenerate JSON Schema from the Zod source
```

CI runs the suite on Linux, macOS, and Windows, and additionally checks that the published JSON
Schema is in sync with the Zod source, that the example collections pass `truspec lint --strict`,
and that the committed example docs are byte-identical to a fresh `truspec docs` render.

## Status & roadmap

TruSpec is **alpha**: the file format is at schema version `0.1` and any breaking change bumps
`SCHEMA_VERSION` and ships a migration.

**Shipped**

- **Format** — the Zod schema, a published JSON Schema, and validation on every write
- **Runner** — REST + GraphQL, bearer / basic / API-key / OAuth2 auth, request chaining via `capture`, pre-/post-request scripts, retries, redirects, and TLS options (`--ca`, `--proxy`, `--insecure`)
- **Spec sync** — drift (added / removed / changed, plus a `--live` API probe), coverage, and response-contract validation (`{ type: schema }`, `run --spec`, `contract`)
- **Mock server** — local and offline, generated from a spec, with latency simulation and request validation
- **CLI** — 14 commands, `--json` everywhere, and `human` / `json` / `junit` / `html` run reporters
- **Secrets** — referenced by name, resolved from the OS env or a project `.env`, masked in run output, and never written into generated snippets
- **Interop** — import from Postman / Bruno / Insomnia / curl / HAR; export back to Postman v2.1
- **Agents** — a first-party MCP server with 23 tools
- **GUI** — the web UI (`truspec serve`) with full request editing, a Flow view, and a command palette; an installable desktop app for Windows / macOS / Linux
- **Editors** — a VS Code extension with CodeLens and a results view (pre-release)

**Next**

- Publish the VS Code extension to the Marketplace
- A Bun-compiled single binary for zero-install distribution (it still needs the `serve` web-client assets embedded and version stamping wired into the compile step)
- Signed and notarized desktop builds, so first launch stops warning

**Deferred by design** (not bloat): hosted dashboards, visual flow builders, exotic protocols, mandatory cloud sync.

## License

[MIT](./LICENSE)
