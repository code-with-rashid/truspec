# TruSpec

> **Local-first, spec-synced, agent-native API client.**
> Your API collection is plain text — your coding agent *and* your CI both read it, run it, and keep it in sync with your OpenAPI spec. Fully offline. No account, ever.

[![CI](https://github.com/code-with-rashid/truspec/actions/workflows/ci.yml/badge.svg)](https://github.com/code-with-rashid/truspec/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
![status: alpha](https://img.shields.io/badge/status-alpha-orange)

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

```bash
truspec run ./api --env local              # run requests, assert, non-zero exit on failure
truspec drift   --spec openapi.yaml ./api --live https://api   # fail CI on drift (vs spec + live API)
truspec coverage --spec openapi.yaml ./api --min 80   # gate on tested-operation coverage
truspec gen     --spec openapi.yaml --out ./api       # scaffold a request per operation
truspec mock    --spec openapi.yaml --port 4000       # offline mock server from your spec
truspec import postman ./postman.json --out ./api     # migrate existing collections
truspec serve   --dir ./api                           # open the local web UI (runs server-side)
```

Two runnable examples live in [`examples/`](./examples): `petstore` and a fuller `blog` API. Try the whole loop offline — mock the spec, run the collection against it, then check drift and coverage:

```bash
git clone https://github.com/code-with-rashid/truspec && cd truspec   # for the example files
truspec mock --spec examples/blog/openapi.yaml &      # serves generated responses
truspec run examples/blog --env local                 # 3 requests PASS against the mock
truspec drift    examples/blog --spec examples/blog/openapi.yaml   # GET /users/{id} untracked
truspec coverage examples/blog --spec examples/blog/openapi.yaml   # 75% (3/4 operations)
```

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

Tools exposed: `truspec_list_collections`, `truspec_run_request`, `truspec_run_collection`, `truspec_create_request`, `truspec_update_request`, `truspec_drift`, `truspec_coverage`, `truspec_scaffold_from_spec`, `truspec_mock_start`, `truspec_mock_stop`. Create/update operations validate against the schema before writing.

## How it fits together

```
@truspec/core  — the engine (pure TS)
  ├─ format      collection parse / serialize / validate (+ published JSON Schema)
  ├─ runner      interpolation, auth, fetch, declarative assertions
  ├─ workspace   discovery, folder inheritance, env + secret resolution
  ├─ spec        OpenAPI drift + coverage
  ├─ importers   Postman v2.1 + Bruno → .tspec.yaml
  └─ mock        local mock server generated from a spec
truspec              — the CLI (run / drift / coverage / gen / import / mock / serve)
@truspec/mcp-server  — the agent surface (10 MCP tools)
@truspec/web         — the web UI + local server (truspec serve)
```

## File format

One request per file (`*.tspec.yaml`), folder config (`folder.tspec.yaml`) for shared base URL/auth/headers, and environments (`environments/*.env.yaml`) where **secrets are referenced by name, never inlined**. The Zod schema in `packages/core/src/format/schema.ts` is the source of truth; a JSON Schema is generated to `packages/core/schema/` for editors and agents. See [`CLAUDE.md`](./CLAUDE.md) for the full reference.

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

**Shipped:** format + JSON Schema · runner (REST + GraphQL, auth, request chaining/capture, **post-response scripts**) · CLI (`run` [+ JUnit], `drift`, `coverage`, `gen`, `import`, `mock`, `serve`) · OpenAPI drift (added/removed/**changed** + **`--live`** API probe) + coverage · **local mock server** (latency + **request validation**) · `.env` + secrets (**masked in run output**) · Postman/Bruno import · MCP server (10 tools) · **web UI** (`truspec serve`) · **VS Code extension** (CodeLens + results view, pre-release).
**Next:** publish v0.5.0 to npm + the extension to the Marketplace · **Bun single-binary** distribution · **in-UI request editing** · **pre-request scripting**.

Deferred by design (not bloat): hosted dashboards, visual flow builders, exotic protocols, mandatory cloud sync.

## License

[MIT](./LICENSE)
