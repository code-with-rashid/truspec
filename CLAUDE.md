# TruSpec — guide for coding agents

This file tells an AI agent how to author **valid** TruSpec files and work in this repo.
Keep it accurate as the format evolves; agents rely on it.

## What this project is

A local-first, spec-synced API client. Collections are plain-text YAML files in the
user's repo and are the single source of truth. Everything works offline. See `README.md`
and the project brief for the strategy; the durable principles are: open-source first,
local-first, agent-native by design, refuse bloat.

## Repository layout

```
packages/
  core/          @truspec/core — the engine (no platform deps)
    src/format/  collection file parse / serialize / validate  ← START HERE
    src/runner/  request execution + assertions          (coming)
    src/spec/    OpenAPI drift + coverage                 (coming)
    src/importers/ postman + bruno import                (coming)
    schema/      PUBLISHED JSON Schema (generated; do not hand-edit)
  cli/           @truspec/cli — `truspec` command         (coming)
  mcp-server/    @truspec/mcp-server                      (coming)
examples/        sample collections used by tests + demos
```

## File format (v0, schema version `0.1`)

The Zod schema in `packages/core/src/format/schema.ts` is the **source of truth**.
The JSON Schema in `packages/core/schema/*.json` is generated from it (`pnpm gen:schema`)
— reference it, don't hand-edit it.

File naming:
- Request: `<name>.tspec.yaml` (one request per file)
- Folder config (inherited by requests in the folder): `folder.tspec.yaml`
- Environment: `environments/<name>.env.yaml`

### Request (`*.tspec.yaml`)

```yaml
tspec: "0.1"                       # schema version (optional; defaults to 0.1)
name: Get pet by id                # required
method: GET                        # GET POST PUT PATCH DELETE HEAD OPTIONS (default GET)
url: "{{baseUrl}}/pets/{{petId}}"  # required; {{var}} resolved at run time
headers:
  Accept: application/json
query:
  expand: owner
body:
  type: json                       # none | json | text | form
  content: { name: "Rex" }
auth:                              # optional; can inherit from folder.tspec.yaml
  type: bearer                     # none | bearer | basic | apikey
  token: "{{token}}"
assertions:                        # declarative + machine-checkable (power CI + coverage)
  - { type: status, equals: 200 }
  - { type: jsonpath, path: "$.id", exists: true }
  - { type: duration, ltMs: 1000 }
docs: "Fetch a single pet by its id."
spec:                              # links request → OpenAPI operation (drift/coverage)
  operation: "GET /pets/{id}"
  operationId: getPetById
```

### Assertion types

- `status` — `equals` | `in: [..]` | `lt` | `gte`
- `header` — `name` + (`equals` | `matches` regex | `exists`)
- `jsonpath` — `path` + (`equals` | `exists` | `matches` regex)
- `body` — `contains` | `matches` regex
- `duration` — `ltMs`

### Environment (`environments/<name>.env.yaml`)

```yaml
tspec: "0.1"
name: local
variables:
  baseUrl: "http://localhost:4000"
  petId: "1"
secrets:                # NAMES only — values come from OS/.env, never stored here
  - token
```

## Conventions (hard rules)

- **Validate before writing.** Use `parse.request.serialize(value)` from `@truspec/core`
  (it validates against the schema and throws on invalid input). Never write a file that
  doesn't parse.
- **Unknown keys are rejected** (`.strict()`) so typos surface immediately.
- **Never inline secrets** into request or environment files. Reference them by name.
- **Keep diffs clean.** One request per file; stable key order; no line-wrapping.
- **Version the schema.** Any breaking change bumps `SCHEMA_VERSION` and ships a migration.

## Working in this repo

- Node ≥ 22, pnpm. `pnpm test` (vitest), `pnpm build` (tsup), `pnpm gen:schema`.
- Write tests alongside each module. Prefer declarative assertions over JS (no JS sandbox in v0).
- Don't add anything from the deferred list (dashboards, flow builders, mandatory cloud,
  exotic protocols) without an explicit human decision.
