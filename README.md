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
| First-party **MCP server** for agents | bolted-on | community | ✓ |
| Import from Postman + Bruno | — | partial | ✓ |

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

**Try it now** — clone the repo for a ready-made collection + OpenAPI spec and run the whole loop offline. These commands work as-is (no placeholders to fill in):

```bash
git clone https://github.com/code-with-rashid/truspec
cd truspec
truspec mock --spec examples/blog/openapi.yaml &
truspec run examples/blog --env local
truspec drift examples/blog --spec examples/blog/openapi.yaml
truspec coverage examples/blog --spec examples/blog/openapi.yaml
```

You should see `run` report **3 passing** requests against the mock, `drift` flag **`GET /users/{id}`** as untracked, and `coverage` show **75% (3/4)**. (Two examples ship in [`examples/`](./examples): `petstore` and a fuller `blog`.)

Point the same commands at **your own** collection — a folder of `.tspec.yaml` files — plus your OpenAPI spec. Replace the `<…>` placeholders:

- `truspec run <dir> --env <name>` — run requests + assertions; non-zero exit on failure
- `truspec drift --spec <openapi.yaml> <dir> [--live <baseUrl>]` — fail CI on drift vs the spec (and a live API)
- `truspec coverage --spec <openapi.yaml> <dir> --min 80` — gate on tested-operation coverage
- `truspec contract --spec <openapi.yaml> <dir> --env <name>` — run + validate responses against the spec's schemas
- `truspec gen --spec <openapi.yaml> --out <dir>` — scaffold a request stub per operation
- `truspec mock --spec <openapi.yaml> --port 4000` — offline mock server from your spec
- `truspec import postman <file.json> --out <dir>` — migrate existing collections (or `truspec import bruno <dir>`)
- `truspec serve --dir <dir>` — open the local web UI

**Chaining:** a request can `capture` a value for later requests in the same run (ordered by `order`) — e.g. log in, capture the token, use it downstream. No scripting required:

```yaml
# 01-login.tspec.yaml →  order: 1,  capture: { token: "$.access_token" }
# 02-me.tspec.yaml    →  order: 2,  auth: { type: bearer, token: "{{token}}" }
```

Every command speaks `--json` for machines, and exits non-zero on failure so it drops straight into CI.

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

Tools exposed: `truspec_list_collections`, `truspec_run_request`, `truspec_run_collection`, `truspec_create_request`, `truspec_update_request`, `truspec_drift`, `truspec_coverage`, `truspec_contract`, `truspec_scaffold_from_spec`, `truspec_mock_start`, `truspec_mock_stop`. Create/update operations validate against the schema before writing.

## How it fits together

```
@truspec/core  — the engine (pure TS)
  ├─ format      collection parse / serialize / validate (+ published JSON Schema)
  ├─ runner      interpolation, auth, fetch, declarative assertions
  ├─ workspace   discovery, folder inheritance, env + secret resolution
  ├─ spec        OpenAPI drift + coverage
  ├─ importers   Postman v2.1 + Bruno → .tspec.yaml
  └─ mock        local mock server generated from a spec
truspec              — the CLI (run / drift / coverage / contract / gen / import / mock / serve)
@truspec/mcp-server  — the agent surface (10 MCP tools)
@truspec/web         — the web UI + local server (truspec serve)
```

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

The CLI runs on Node ≥ 22. A Bun-compiled single binary for zero-install distribution is planned (it still needs the `serve` web-client assets embedded and version stamping wired into the compile step).

## Status & roadmap

**Shipped:** format + JSON Schema · runner (REST + GraphQL, auth, request chaining/capture, **post-response scripts**) · CLI (`run` [+ JUnit], `drift`, `coverage`, `contract`, `gen`, `import`, `mock`, `serve`) · OpenAPI drift (added/removed/**changed** + **`--live`** API probe) + coverage + **response contract validation** (`{ type: schema }` · `run --spec` · `contract`) · **local mock server** (latency + **request validation**) · `.env` + secrets (**masked in run output**) · Postman/Bruno import · MCP server (11 tools) · **web UI** (`truspec serve`) · **VS Code extension** (CodeLens + results view, pre-release).
**Next:** publish v0.5.0 to npm + the extension to the Marketplace · **Bun single-binary** distribution · **in-UI request editing** · **pre-request scripting**.

Deferred by design (not bloat): hosted dashboards, visual flow builders, exotic protocols, mandatory cloud sync.

## License

[MIT](./LICENSE)
