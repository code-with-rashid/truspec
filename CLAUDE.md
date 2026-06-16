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
  core/          @truspec/core — the engine (pure modules have no platform deps)
    src/format/      collection parse / serialize / validate (+ JSON Schema)  ← START HERE
    src/runner/      interpolation, auth, fetch, declarative assertions
    src/workspace/   discovery, folder inheritance, env + secret resolution
    src/spec/        OpenAPI drift + coverage
    src/importers/   postman v2.1 + bruno -> .tspec.yaml
    src/mock/        local mock server generated from a spec
    schema/          PUBLISHED JSON Schema (generated; do not hand-edit)
  cli/           truspec — `run` / `drift` / `coverage` / `gen` / `import` / `mock`
  mcp-server/    @truspec/mcp-server — 10 tools over the official MCP SDK
examples/        petstore + blog sample collections (+ openapi.yaml) for tests + demos
```

Core modules are imported via subpaths: `@truspec/core/format`, `/runner`, `/workspace`,
`/spec`, `/importers`, `/mock`. The filesystem/server modules (`workspace`, `spec`,
`importers`, `mock`) are kept out of the browser-safe main entry on purpose.

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
  type: json                       # none | json | text | form | graphql
  content: { name: "Rex" }
auth:                              # optional; can inherit from folder.tspec.yaml
  type: bearer                     # none | bearer | basic | apikey
  token: "{{token}}"
assertions:                        # declarative + machine-checkable (power CI + coverage)
  - { type: status, equals: 200 }
  - { type: jsonpath, path: "$.id", exists: true }
  - { type: duration, ltMs: 1000 }
capture:                           # save response values into vars for later requests
  token: "$.access_token"          # jsonpath shorthand; or { header: "X-Id" } / { status: true }
order: 1                           # run order within a collection (lower first; default 0)
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

### GraphQL body

```yaml
body:
  type: graphql
  query: "query($id: ID!) { user(id: $id) { name } }"
  variables: { id: "{{userId}}" }
```

Sent as a POST with a JSON `{ query, variables }` body.

### Capture & chaining

`capture` saves response values into variables for *later* requests in the same run.
Requests run in `order` (then path), so a login can capture a token the next request uses:

```yaml
# 01-login.tspec.yaml  →  order: 1,  capture: { token: "$.access_token" }
# 02-call.tspec.yaml   →  order: 2,  auth: { type: bearer, token: "{{token}}" }
```

A capture source is a jsonpath string, or `{ jsonpath }` / `{ header }` / `{ status: true }`.

### Pre-request script (advanced)

Runs **before** the request is resolved, to compute values it then interpolates (dynamic
timestamps/nonces, request signing, derived headers). Prefer declarative fields; reach for a
script only when substitution can't express it.

```yaml
script:
  pre: |
    tr.set("nonce", tr.uuid())
    tr.set("ts", new Date().toISOString())
    tr.set("sig", tr.hmac("sha256", tr.vars.apiSecret, tr.vars.ts + tr.vars.nonce))
headers:
  X-Nonce: "{{nonce}}"
  X-Signature: "{{sig}}"
```

Node vm context with a `tr` API (no response yet): `tr.vars` (read), `tr.set(name, value)`
(set a variable used by this request), `tr.uuid()`, `tr.base64(s)`,
`tr.hmac(algo, key, data, enc?)` (`enc` = `"hex"` default | `"base64"`), `tr.env(name)`.
A script error fails the request without sending it. It sets *variables* (not the request
object directly), so build any computed body/header value as a variable and reference it.

### Post-response script (advanced)

```yaml
script:
  post: |
    tr.set("token", tr.response.json.access_token)
    tr.expect(tr.response.status === 200, "logged in")
```

Runs in a Node vm context exposing `tr.response` ({ status, headers, bodyText, json }),
`tr.set(name, value)`, `tr.expect(cond, msg)`, and `tr.vars`. **Neither script is a security
sandbox** — scripts are authored in your collection; only run collections you trust.

### Environment (`environments/<name>.env.yaml`)

```yaml
tspec: "0.1"
name: local
variables:
  baseUrl: "http://localhost:4000"
  petId: "1"
secrets:                # NAMES only — values come from OS env or a project .env, never stored here
  - token
```

A `.env` file at the workspace root is also loaded for secret resolution (real OS env vars win).

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
