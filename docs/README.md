# TruSpec Documentation

> **Local-first, spec-synced, agent-native API client.**
> Your API collection is plain-text YAML in your repo. Your coding agent *and* your
> CI both read it, run it, and keep it in sync with your OpenAPI spec — fully offline,
> no account, ever.

This is the complete reference for TruSpec. If you're new, start with
**[Getting started](./getting-started.md)** and the **[Core concepts](./concepts.md)**;
if you're looking for a specific field, flag, or function, jump straight to the relevant
reference below.

---

## Start here

| Guide | What it covers |
|---|---|
| **[Getting started](./getting-started.md)** | Install, run the example loop in 60 seconds, and write your first request. |
| **[Core concepts](./concepts.md)** | The mental model: collections, the workspace, spec-as-source-of-truth, and how a run flows. |

## Reference

| Reference | What it covers |
|---|---|
| **[File format](./file-format.md)** | Every field of `*.tspec.yaml`, `folder.tspec.yaml`, and environment files — assertions, bodies, auth, capture, and variables. |
| **[CLI](./cli.md)** | All 14 commands and every flag: `init`, `run`, `drift`, `coverage`, `contract`, `gen`, `codegen`, `lint`, `docs`, `env`, `import`, `export`, `mock`, `serve` — with exit codes and output formats. |
| **[Programmatic API](./api.md)** | Using `@truspec/core` from TypeScript: `format`, `runner`, `workspace`, `spec`, `importers`, `exporters`, `codegen`, `lint`, `docs`, `mock`, and more. |

## Guides

| Guide | What it covers |
|---|---|
| **[Spec sync: drift & coverage](./spec-sync.md)** | The flagship feature — keep your collection and OpenAPI spec honest, gate CI on drift and coverage, scaffold from a spec, probe a live API. |
| **[Mock server](./mocking.md)** | Run an offline mock of any OpenAPI spec, with latency and request validation. |
| **[Importing](./importing.md)** | Migrate existing collections from Postman, Bruno, Insomnia, curl, or HAR — and export back out to Postman. |
| **[Chaining, auth & variables](./file-format.md#chaining-with-capture)** | Log in, capture a token, and reuse it downstream — no scripting required. |
| **[Scripting](./scripting.md)** | The advanced escape hatch: pre-request and post-response scripts and the `tr` API. |
| **[CI/CD integration](./ci.md)** | Wire `truspec` into GitHub Actions and any other CI, with JUnit reports and masked secrets. |
| **[AI agents (MCP)](./mcp.md)** | The first-party MCP server: 23 tools for Claude Code, Cursor, and other agents. |
| **[Editors: Web UI & VS Code](./editors.md)** | The local web UI (`truspec serve`) and the VS Code extension. |
| **[FAQ & troubleshooting](./faq.md)** | Common questions, error messages, and how to fix them. |

---

## What is TruSpec, in one minute

The API-client market runs from **local-and-minimal** (Bruno) to **cloud-and-everything**
(Postman). TruSpec owns the intersection nobody else does: an integrated engine where

- **your OpenAPI spec is the source of truth**,
- **your collection is plain text** that diffs cleanly in Git,
- and **an AI agent or CI pipeline can run it and fail the build** the moment your code
  drifts from the spec — **entirely offline**.

A collection is just a folder of YAML files:

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
truspec run ./api --env local                 # run requests + assertions
truspec drift    --spec openapi.yaml ./api     # fail CI when code drifts from the spec
truspec coverage --spec openapi.yaml ./api     # report which operations are tested
```

## The packages

TruSpec is a small monorepo. Most users only ever install `truspec` (the CLI).

| Package | npm | Role |
|---|---|---|
| **`truspec`** | [`truspec`](https://www.npmjs.com/package/truspec) | The CLI: `run` / `drift` / `coverage` / `contract` / `gen` / `import` / `mock` / `serve`. |
| **`@truspec/core`** | [`@truspec/core`](https://www.npmjs.com/package/@truspec/core) | The engine — pure TypeScript modules with no platform lock-in. Import it to build your own tooling. |
| **`@truspec/mcp-server`** | [`@truspec/mcp-server`](https://www.npmjs.com/package/@truspec/mcp-server) | The agent surface — 23 MCP tools over the official SDK. |
| **`@truspec/web`** | — | The local web UI served by `truspec serve`. |
| **TruSpec for VS Code** | — | CodeLens to run requests and check drift/coverage from your editor. |

## Conventions in this documentation

- Shell snippets assume the `truspec` CLI is on your `PATH`. Every command also works via
  `npx truspec …` without a global install.
- `<…>` marks a placeholder you replace; everything else is copy-paste-safe.
- "Workspace" means the root of your collection — the directory TruSpec discovers
  environments and folder config from. See [Core concepts](./concepts.md#the-workspace).

## Project links

- **Repository:** <https://github.com/code-with-rashid/truspec>
- **Issues:** <https://github.com/code-with-rashid/truspec/issues>
- **License:** [MIT](../LICENSE)
- **Contributing:** [CONTRIBUTING.md](../CONTRIBUTING.md)
