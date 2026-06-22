# Programmatic API (`@truspec/core`)

The CLI, the MCP server, the web UI, and the VS Code extension are all thin shells over one
engine: **`@truspec/core`**. You can import it directly to build your own tooling — a
custom runner, a CI script, a code-gen step, or an editor integration.

```bash
npm install @truspec/core
```

The engine is pure TypeScript (ships its own types) and side-effect-free. The browser-safe
modules (`format`, `runner`) have no platform dependencies; the filesystem/server modules
(`workspace`, `spec`, `importers`, `mock`) use Node APIs and are kept out of the main entry
on purpose.

> **Requires Node ≥ 22** for the filesystem/server modules (it uses the platform `fetch`
> and modern streaming APIs).

---

## Modules

Import each capability from its subpath:

```ts
import { parse, RequestSchema } from "@truspec/core/format";
import { runRequest } from "@truspec/core/runner";
import { runPath, discoverRequests } from "@truspec/core/workspace";
import { driftReport, coverageReport } from "@truspec/core/spec";
import { importPostmanFile } from "@truspec/core/importers";
import { startMockServer } from "@truspec/core/mock";
```

| Subpath | Purpose | Platform |
|---|---|---|
| `@truspec/core/format` | Parse / serialize / validate files; schemas & types. | browser-safe |
| `@truspec/core/runner` | Execute one request; interpolation, auth, assertions, scripts. | browser-safe |
| `@truspec/core/workspace` | Discovery, folder inheritance, env + secret resolution, run a path. | Node |
| `@truspec/core/spec` | OpenAPI parsing, drift, coverage, scaffold, live probe. | Node |
| `@truspec/core/importers` | Postman & Bruno → `.tspec.yaml`. | Node |
| `@truspec/core/mock` | Local mock server from a spec. | Node |

The main entry (`@truspec/core`) re-exports `format` and `runner` as namespaces; prefer the
subpaths above so bundlers can tree-shake and you don't pull Node modules into a browser
build.

---

## `format` — parse, validate, serialize

The format module is the **single most useful import**: it validates that something is a
legal TruSpec file before you write it.

### `parse`

`parse` exposes three helpers — `parse.request`, `parse.folderConfig`, and
`parse.environment` — each with the same four methods:

```ts
import { parse } from "@truspec/core/format";

// parse(text) → throws on invalid input, with a readable message
const req = parse.request.parse(yamlText);

// safeParse(text) → never throws; { ok, data?, error?, issues? }
const result = parse.request.safeParse(yamlText);
if (!result.ok) console.error(result.error);

// validate(value) → validate an already-parsed object (e.g. an agent's write payload)
const v = parse.request.validate({ name: "x", url: "{{base}}/x" });

// serialize(value) → validate, then emit clean, diff-friendly YAML
const yaml = parse.request.serialize(req);
```

| Method | Signature | Behavior |
|---|---|---|
| `parse` | `(text: string) => T` | Parse YAML; **throws** on invalid input. |
| `safeParse` | `(text: string) => ParseResult<T>` | Parse YAML without throwing. |
| `validate` | `(value: unknown) => ParseResult<T>` | Validate an in-memory object. |
| `serialize` | `(value: T) => string` | **Validate, then** serialize to YAML. |

`serialize` validates *before* producing YAML — the hard rule that lets agents and scripts
never emit an invalid file. `ParseResult<T>` is `{ ok: boolean; data?: T; error?: string;
issues?: ZodIssue[] }`.

### Schemas & types

The [Zod](https://zod.dev) schemas and their inferred TypeScript types are exported for
building and validating requests programmatically:

```ts
import {
  RequestSchema, FolderConfigSchema, EnvironmentSchema,
  Assertion, Auth, Body, CaptureSource, HttpMethod,
  SCHEMA_VERSION,
} from "@truspec/core/format";

import type {
  TruSpecRequest, TruSpecFolderConfig, TruSpecEnvironment,
  TruSpecAssertion, TruSpecAuth, TruSpecBody, TruSpecMethod, TruSpecCaptureSource,
} from "@truspec/core/format";
```

### `buildJsonSchemas`

Generate the JSON Schema documents from the Zod source (this is what `pnpm gen:schema`
calls):

```ts
import { buildJsonSchemas } from "@truspec/core/format";
const { request, folder, environment } = buildJsonSchemas();
```

---

## `runner` — execute a request

`runRequest` runs a single, already-parsed request and evaluates its assertions. **It never
throws** — every failure (network error, unresolved variable, failed assertion) lands in
the returned `RunResult`.

```ts
import { runRequest } from "@truspec/core/runner";

const result = await runRequest(request, {
  folder,                 // optional TruSpecFolderConfig to inherit from
  vars: { baseUrl: "http://localhost:4000", petId: "1" },
  timeoutMs: 10_000,      // default 30000; 0 disables
});

console.log(result.ok, result.response?.status);
for (const a of result.assertions) console.log(a.ok, a.message);
```

### `RunContext`

| Field | Type | Notes |
|---|---|---|
| `folder` | `TruSpecFolderConfig` | Inherited base URL / headers / auth. |
| `vars` | `Vars` | Variables for interpolation. |
| `fetch` | `typeof fetch` | Inject a custom fetch (tests, proxies). Defaults to global `fetch`. |
| `now` | `() => number` | Inject a clock for deterministic durations. |
| `timeoutMs` | `number` | Per-request timeout. Default `30000`; `0` disables. |
| `maxResponseBytes` | `number` | Cap on the response body (default 50 MB) to bound memory. |

### `RunResult`

`{ name, request: { method, url }, filePath?, ok, error?, missingVars?, response?: {
status, statusText, durationMs, headers, bodyText }, assertions: AssertionResult[],
captured? }`.

### Lower-level building blocks

The runner also exports the pieces `runRequest` is built from, in case you need them
directly:

| Export | Purpose |
|---|---|
| `resolveRequest(req, opts)` | Interpolate + apply folder/auth → a concrete `EffectiveRequest`. |
| `interpolate(str, vars)` / `interpolateDeep(obj, vars)` | `{{var}}` substitution, reporting missing names. |
| `jsonpath(value, path)` | The JSONPath selector used by assertions and capture. |
| `evaluateAssertions(list, view)` | Run assertions against a `ResponseView`. |
| `evaluateCaptures(map, view)` | Extract captured variables from a response. |
| `runPreScript(src, vars)` / `runPostScript(src, view, vars)` | The script runtimes. |
| `deepEqual(a, b)` | Structural equality used by `equals` assertions. |

---

## `workspace` — discover & run a collection

This module turns a directory of files into a run, applying discovery, folder inheritance,
environment loading, and secret resolution.

### `runPath`

The function behind `truspec run`:

```ts
import { runPath } from "@truspec/core/workspace";

const summary = await runPath("./api", {
  env: "local",          // environments/local.env.yaml
  cwd: process.cwd(),
  spec: "./openapi.yaml",// optional — validate each spec-linked response against its schema
  // vars, fetch, now, timeoutMs, processEnv all optional
});

console.log(summary.passed, summary.failed, summary.ok);
```

Returns a `WorkspaceRunResult`: `{ results: RunResult[], passed, failed, ok,
missingSecrets }`. It parses every request, runs them in `order` (then path) so
[captures](./file-format.md#chaining-with-capture) chain forward, and
[masks declared secrets](./file-format.md#environment-files) in the reported results.

### Other helpers

| Export | Purpose |
|---|---|
| `discoverRequests(dir)` | Recursively list request files (cycle-safe, workspace-confined). |
| `findWorkspaceRoot(dir)` | Walk up to a dir with `environments/` or `.git`. |
| `loadEnvironment(from, name)` / `buildVars(env, processEnv)` | Load an env file; build its variable map (resolving secrets). |
| `loadFolderChain(leaf, root)` / `mergeFolderConfigs(chain)` | Compose folder config root → leaf. |
| `loadDotenv(dir)` | Parse a workspace `.env`. |
| `confinePath(cwd, target)` | Resolve a path and reject anything that escapes the workspace (symlink-safe). |

---

## `spec` — drift, coverage, contract, OpenAPI

The functions behind `truspec drift` / `coverage` / `contract` / `gen`.

```ts
import {
  driftReport, liveDriftReport, coverageReport, contractReport,
  scaffoldFromSpec, writeScaffold, parseOpenApi, validateAgainstSchema,
} from "@truspec/core/spec";

const drift = driftReport("./api", "./openapi.yaml");          // DriftReport
const live  = await liveDriftReport("./api", "./openapi.yaml", "https://api.example.com");
const cov   = coverageReport("./api", "./openapi.yaml", 80);   // CoverageReport (min 80%)
const ctr   = await contractReport("./api", "./openapi.yaml", { env: "local" }); // ContractReport

// Scaffold stubs from a spec, then write them:
const result = scaffoldFromSpec(specText, { baseUrlVar: "baseUrl" });
writeScaffold(result.files, "./api");
```

| Export | Returns | Notes |
|---|---|---|
| `parseOpenApi(text)` | `OpenApiSummary` | Flat operation list (with response schemas) from an OpenAPI 3 doc. |
| `driftReport(dir, specPath)` | `DriftReport` | `{ added, removed, changed, ok, … }`. |
| `liveDriftReport(dir, specPath, baseUrl, opts?)` | `Promise<DriftReport>` | Adds `liveMissing` from a GET/HEAD probe. |
| `coverageReport(dir, specPath, minPercent?)` | `CoverageReport` | `{ covered, uncovered, percent, ok }`. |
| `contractReport(dir, specPath, opts?)` | `Promise<ContractReport>` | Runs the collection; `{ conformed, violations, skipped, untested, ok }`. |
| `validateAgainstSchema(value, schema, doc)` | `SchemaViolation[]` | Validate any value against an OpenAPI 3 schema subset. |
| `scaffoldFromSpec(text, opts?)` | `ScaffoldResult` | `{ files, skipped }`. |
| `writeScaffold(files, outDir)` | `string[]` | Paths written. |
| `computeDrift` / `computeCoverage` | reports | Pure functions over parsed operations. |
| `probeLiveOperations(ops, baseUrl, opts?)` | `Promise<LiveProbeResult>` | The GET/HEAD live probe. |

See [Spec sync](./spec-sync.md) for what these reports mean.

---

## `importers` — Postman & Bruno

```ts
import { importPostmanFile, importBrunoDir, writeImport } from "@truspec/core/importers";

const result = importPostmanFile("./postman_collection.json");  // ImportResult
// result.files: { path, content }[]  ·  result.warnings: string[]  ·  result.stats
writeImport(result, "./api");
```

`ImportResult` is `{ files: ImportedFile[]; warnings: string[]; stats: { requests, folders
} }`. See [Importing](./importing.md).

---

## `mock` — local mock server

```ts
import { startMockServer } from "@truspec/core/mock";

const handle = await startMockServer(specText, { port: 4000, delayMs: 0, validate: false });
// handle: { port, url, routes, close }
await handle.close();
```

| Option | Default | Notes |
|---|---|---|
| `port` | `0` (free port) | Port to bind. |
| `host` | `127.0.0.1` | Bind address. |
| `delayMs` | `0` | Per-response latency. |
| `validate` | `false` | Validate requests against the spec (`400` on mismatch). |

See [Mock server](./mocking.md).

---

## End-to-end example

Validate, write, run, and check coverage — entirely in code:

```ts
import { parse } from "@truspec/core/format";
import { runPath } from "@truspec/core/workspace";
import { coverageReport } from "@truspec/core/spec";
import { writeFileSync, mkdirSync } from "node:fs";

// 1. Build and validate a request, then write it.
const req = parse.request.validate({
  name: "Get pet",
  method: "GET",
  url: "{{baseUrl}}/pets/{{petId}}",
  assertions: [{ type: "status", equals: 200 }],
  spec: { operation: "GET /pets/{id}" },
});
if (!req.ok) throw new Error(req.error);
mkdirSync("api", { recursive: true });
writeFileSync("api/get-pet.tspec.yaml", parse.request.serialize(req.data!));

// 2. Run the collection.
const run = await runPath("./api", { env: "local" });
console.log(`${run.passed}/${run.results.length} passed`);

// 3. Gate on coverage.
const cov = coverageReport("./api", "./openapi.yaml", 80);
if (!cov.ok) throw new Error(`Coverage ${cov.percent}% below 80%`);
```

---

## See also

- **[File format](./file-format.md)** — the shapes `format` validates.
- **[Core concepts](./concepts.md)** — discovery, inheritance, and the run pipeline these
  functions implement.
- **[CLI reference](./cli.md)** — the command-line surface over these same functions.
