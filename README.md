# TruSpec

> **Local-first, spec-synced, agent-native API client.**
> Your API collection is plain text — your coding agent *and* your CI both read it, run it, and keep it in sync with your OpenAPI spec. Fully offline. No account, ever.

[![status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange)](#status)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

---

## Why TruSpec

The API-client market runs from **local-and-minimal** (Bruno) to **cloud-and-everything** (Postman). TruSpec doesn't try to out-feature either. It owns one unclaimed intersection:

**an integrated engine where your OpenAPI spec is the source of truth, your collection is plain text, and an AI agent or CI pipeline can run it and fail the build the moment your code drifts from the spec — entirely offline.**

No single tool does all of this today: incumbents have the request client *or* drift detection *or* a mock server, never the integrated, local-first, agent-readable whole.

| | Postman | Bruno | TruSpec |
|---|:---:|:---:|:---:|
| Local files + Git source of truth | ✗ | ✓ | ✓ |
| Fully offline, no account | ✗ | ✓ | ✓ |
| Open source (MIT) | ✗ | ✓ | ✓ |
| OpenAPI **drift detection** | ✗ | basic | ✓ (CI gate) |
| OpenAPI **coverage** report | ✗ | ✗ | ✓ |
| Local **mock server** (no cloud) | cloud | ✗ | ✓ *(v1)* |
| Agent surface | bolted-on | community | files + CLI + MCP, designed-in |

## How it works

Your collection is a folder of plain-text YAML files that diff cleanly and live in your repo:

```yaml
# get-pet.tspec.yaml
name: Get pet by id
method: GET
url: "{{baseUrl}}/pets/{{petId}}"
assertions:
  - { type: status, equals: 200 }
  - { type: jsonpath, path: "$.id", exists: true }
spec:
  operation: "GET /pets/{id}"   # links back to your OpenAPI spec
```

Then:

```bash
truspec run ./api --env local           # run requests, assert, exit non-zero on failure
truspec drift --spec openapi.yaml       # fail CI when collection ≠ spec
truspec coverage --spec openapi.yaml    # which endpoints lack a tested request?
```

Every command speaks `--json`, and the same operations are exposed over a first-party **MCP server** so coding agents (Claude Code, etc.) can author, run, and sync collections directly.

## Status

**Pre-alpha — actively being built.** Current focus is the wedge-first v0:

- [x] Monorepo + collection format (`@truspec/core` · YAML schema + published JSON Schema)
- [ ] Request runner (interpolation, auth, assertions)
- [ ] `truspec run` CLI
- [ ] OpenAPI **drift** + **coverage**
- [ ] Postman + Bruno import
- [ ] MCP server

Deferred by design (not bloat): hosted dashboards, visual flow builders, exotic protocols, mandatory cloud sync. GraphQL, a JS scripting sandbox, and the web/VS Code UIs come after the wedge lands.

## Develop

```bash
pnpm install
pnpm test          # vitest
pnpm build         # tsup → dist
pnpm gen:schema    # regenerate packages/core/schema/*.json from the Zod source
```

> The CLI ships as a Bun-compiled single binary for distribution; the dev loop runs on Node ≥ 22.

## License

[MIT](./LICENSE)
