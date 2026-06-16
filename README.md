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
| First-party **MCP server** for agents | bolted-on | community | ✓ |
| Import from Postman + Bruno | — | partial | ✓ |

## Quickstart

> Pre-publish: run from source. Requires Node ≥ 22 and pnpm.

```bash
git clone https://github.com/code-with-rashid/truspec
cd truspec
pnpm install && pnpm build
node packages/cli/dist/index.js --help
```

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
truspec drift   --spec openapi.yaml ./api   # fail CI when collection ≠ spec
truspec coverage --spec openapi.yaml ./api --min 80   # gate on tested-operation coverage
truspec import postman ./postman.json --out ./api     # migrate existing collections
```

Every command speaks `--json` for machines, and exits non-zero on failure so it drops straight into CI.

## Use it from an AI agent (MCP)

TruSpec ships a first-party [MCP](https://modelcontextprotocol.io) server so agents like Claude Code can author, run, and sync collections directly.

```bash
# from the repo root, after `pnpm build`:
claude mcp add truspec -- node ./packages/mcp-server/dist/index.js
```

Or add it to your MCP client config:

```json
{
  "mcpServers": {
    "truspec": { "command": "node", "args": ["./packages/mcp-server/dist/index.js"] }
  }
}
```

Tools exposed: `truspec_list_collections`, `truspec_run_request`, `truspec_run_collection`, `truspec_create_request`, `truspec_update_request`, `truspec_drift`, `truspec_coverage`, `truspec_scaffold_from_spec`. Create/update operations validate against the schema before writing.

## How it fits together

```
@truspec/core  — the engine (pure TS)
  ├─ format      collection parse / serialize / validate (+ published JSON Schema)
  ├─ runner      interpolation, auth, fetch, declarative assertions
  ├─ workspace   discovery, folder inheritance, env + secret resolution
  ├─ spec        OpenAPI drift + coverage
  └─ importers   Postman v2.1 + Bruno → .tspec.yaml
truspec              — the CLI (run / drift / coverage / import)
@truspec/mcp-server  — the agent surface
```

## File format

One request per file (`*.tspec.yaml`), folder config (`folder.tspec.yaml`) for shared base URL/auth/headers, and environments (`environments/*.env.yaml`) where **secrets are referenced by name, never inlined**. The Zod schema in `packages/core/src/format/schema.ts` is the source of truth; a JSON Schema is generated to `packages/core/schema/` for editors and agents. See [`CLAUDE.md`](./CLAUDE.md) for the full reference.

## Development

```bash
pnpm test            # vitest (85 tests)
pnpm test:coverage   # v8 coverage
pnpm typecheck
pnpm build
pnpm gen:schema      # regenerate JSON Schema from the Zod source
```

The CLI ships as a Bun-compiled single binary for distribution; the dev loop runs on Node ≥ 22.

## Status & roadmap

**v0 (done):** format + JSON Schema · runner · `run` CLI · OpenAPI drift + coverage · Postman/Bruno import · MCP server.
**Next:** local mock server (from spec) · publish to npm · GraphQL · JS scripting · web + VS Code UIs sharing the core.

Deferred by design (not bloat): hosted dashboards, visual flow builders, exotic protocols, mandatory cloud sync.

## License

[MIT](./LICENSE)
