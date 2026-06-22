# CLI reference

The `truspec` command is the primary way to use TruSpec. Every command works offline,
speaks `--json` for machines, and exits non-zero on failure so it drops straight into CI.

```
truspec <command> [args] [flags]
```

```bash
npm i -g truspec      # global install — or prefix any command with `npx`
truspec --help
truspec --version
```

| Command | One-liner |
|---|---|
| [`run`](#run) | Run a request file or directory; non-zero exit on assertion failure. |
| [`drift`](#drift) | Diff a collection against an OpenAPI spec; non-zero exit on drift. |
| [`coverage`](#coverage) | Report which spec operations have a tested request. |
| [`contract`](#contract) | Run the collection and validate responses against the spec's schemas. |
| [`gen`](#gen) | Scaffold a request stub per operation from a spec. |
| [`import`](#import) | Convert a Postman or Bruno collection to `.tspec.yaml`. |
| [`mock`](#mock) | Serve generated responses from a spec (offline). |
| [`serve`](#serve) | Open the local web UI for a collection. |

**Global flags:** `--help` / `-h`, `--version` / `-v`.

---

## Exit codes

Commands return conventional exit codes so they gate CI without extra glue:

| Code | Meaning |
|---|---|
| `0` | Success — run passed / no drift / coverage at or above threshold. |
| `1` | Failure — assertions failed, drift detected, coverage below `--min`, or a runtime error. |
| `2` | Usage error — a required argument or flag is missing/invalid. |

---

## `run`

Run a single request file or a whole directory of requests, evaluating each request's
assertions.

```
truspec run <path> [--env <name>] [--spec <openapi>] [--json] [--reporter <fmt>] [--output <file>] [--timeout <ms>]
```

| Flag | Alias | Description |
|---|---|---|
| `--env <name>` | `-e` | Environment to load (`environments/<name>.env.yaml`). |
| `--spec <openapi>` | `-s` | Validate each spec-linked request's response against the OpenAPI response schema. |
| `--json` | | Shorthand for `--reporter json`. |
| `--reporter <fmt>` | | Output format: `human` (default), `json`, or `junit`. |
| `--output <file>` | `-o` | Write the report to a file instead of stdout. |
| `--timeout <ms>` | | Per-request timeout. Default `30000`. Use `0` to disable. |

`<path>` may be a single `.tspec.yaml` file or a directory. A directory is searched
recursively; requests run in `order` (ascending) then by file path, so
[captured values](./file-format.md#chaining-with-capture) chain forward.

**Exit code:** `0` if every request passed, `1` if any failed (or on error), `2` on usage
error.

### Examples

```bash
truspec run ./api --env local                 # run a collection
truspec run ./api/get-pet.tspec.yaml          # run one request
truspec run ./api --env local --spec openapi.yaml  # also validate responses vs the spec
truspec run ./api --json                       # machine-readable output
truspec run ./api --reporter junit -o junit.xml   # JUnit XML for CI test reporters
truspec run ./api --timeout 5000               # 5s per-request timeout
```

### Human output

```
✓ PASS  Get pet by id  (api/get-pet.tspec.yaml)  200 41ms
✗ FAIL  Create post    (api/create-post.tspec.yaml)  500 88ms
      ✗ status 500 fails == 201

1 passed, 1 failed, 2 total
```

### JSON output

`--json` emits the full `WorkspaceRunResult` (see
[Programmatic API](./api.md#runpath)):

```json
{
  "results": [
    {
      "name": "Get pet by id",
      "request": { "method": "GET", "url": "http://localhost:4000/pets/1" },
      "filePath": "/abs/api/get-pet.tspec.yaml",
      "ok": true,
      "response": { "status": 200, "statusText": "OK", "durationMs": 41, "headers": {}, "bodyText": "…" },
      "assertions": [ { "type": "status", "ok": true, "message": "status 200 satisfies == 200" } ],
      "captured": { "ownerId": "7" }
    }
  ],
  "passed": 1,
  "failed": 0,
  "ok": true,
  "missingSecrets": []
}
```

> **Secrets are masked.** Declared secret values are replaced with `***` throughout the
> output (URLs, bodies, headers, captured values, errors). See
> [File format → Environments](./file-format.md#environment-files).

### JUnit output

`--reporter junit` emits a JUnit `<testsuites>` document — one `<testcase>` per request —
that CI test reporters (GitHub Actions, GitLab, Jenkins, etc.) understand natively. Pair it
with `--output` to write a file the reporter can pick up.

### Notes

- If no requests are found under `<path>`, the command warns and reports zero total.
- If a declared secret is unresolved, a warning naming it is printed to stderr (the run
  still proceeds).

---

## `drift`

Diff a collection against an OpenAPI spec and exit non-zero when they've drifted apart.
This is the flagship CI gate — see the [Spec sync guide](./spec-sync.md) for the full
picture.

```
truspec drift --spec <openapi> [<dir>] [--live <baseUrl>] [--timeout <ms>] [--json] [--output <file>]
```

| Flag | Alias | Description |
|---|---|---|
| `--spec <openapi>` | `-s` | **Required.** Path to the OpenAPI document (YAML or JSON). |
| `--live <baseUrl>` | | Also probe a running API for operations it doesn't serve (GET/HEAD only). |
| `--timeout <ms>` | | Per-probe timeout for `--live`. |
| `--json` | | Machine-readable `DriftReport`. |
| `--output <file>` | `-o` | Write the report to a file. |

`<dir>` is the collection directory; it defaults to `.` (the current directory).

**Reports four categories:**

- **Untracked (added)** — in the spec, but no request references it.
- **Stale (removed)** — referenced by a request, but no longer in the spec.
- **Changed** — matched, but the request no longer satisfies the spec (e.g. a now-required
  query param or request body is missing).
- **Missing from live API** — with `--live`, spec operations a running API doesn't serve.

**Exit code:** `0` if there's no drift, `1` if drift is detected (or on error), `2` if
`--spec` is missing.

### Examples

```bash
truspec drift --spec openapi.yaml ./api
truspec drift --spec openapi.yaml ./api --live https://api.staging.example.com
truspec drift --spec openapi.yaml ./api --json
```

```
Spec operations: 4   Collection operations: 3

Untracked in collection (1):
  + GET /users/{id}

Drift detected: 1 untracked, 0 stale, 0 changed.
```

---

## `coverage`

Report what share of spec operations are exercised by a request *with assertions*, and
optionally gate on a minimum.

```
truspec coverage --spec <openapi> [<dir>] [--min <percent>] [--json] [--output <file>]
```

| Flag | Alias | Description |
|---|---|---|
| `--spec <openapi>` | `-s` | **Required.** Path to the OpenAPI document. |
| `--min <percent>` | | Fail if coverage is below this percentage. Default `0` (report-only). |
| `--json` | | Machine-readable `CoverageReport`. |
| `--output <file>` | `-o` | Write the report to a file. |

`<dir>` defaults to `.`. An operation counts as covered only if a request both references
it (via [`spec`](./file-format.md#spec-link)) **and** has at least one assertion.

**Exit code:** `0` if coverage ≥ `--min`, `1` if below (or on error), `2` if `--spec` is
missing.

### Examples

```bash
truspec coverage --spec openapi.yaml ./api            # report only
truspec coverage --spec openapi.yaml ./api --min 80   # gate at 80%
```

```
Coverage: 75% (3/4 operations tested)

Uncovered (1):
  ✗ GET /users/{id}
```

---

## `contract`

Run the collection and validate each response **body against the spec's OpenAPI response
schema** for the matched operation. Where `drift` and `coverage` are static, `contract`
exercises the API and catches *behavioral* drift. See the
[Spec sync guide](./spec-sync.md#response-validation-contract).

```
truspec contract --spec <openapi> [<dir>] [--env <name>] [--timeout <ms>] [--json] [--output <file>]
```

| Flag | Alias | Description |
|---|---|---|
| `--spec <openapi>` | `-s` | **Required.** Path to the OpenAPI document. |
| `--env <name>` | `-e` | Environment to load (base URL + secrets), like `run`. |
| `--timeout <ms>` | | Per-request timeout. Default `30000`. |
| `--json` | | Machine-readable `ContractReport`. |
| `--output <file>` | `-o` | Write the report to a file. |

`<dir>` defaults to `.`. Because it sends real requests, point it at a
[mock](./mocking.md) or a live API via the environment's `baseUrl`.

**Exit code:** `0` if every exercised response conforms, `1` on any schema violation (or on
error), `2` if `--spec` is missing. Untested and status-undocumented operations are reported
but never fail the gate.

```bash
truspec contract --spec openapi.yaml ./api --env local
```

```
Contract: 2/3 tested operations conform to the spec
  ✓ GET /posts
  ✓ GET /posts/{id}

Violations (1):
  ✗ POST /posts  →  schema: 1 violation(s) — /author/id: missing required property 'id'

Untested — no request exercises these (1, see `coverage`):
  – GET /users/{id}

Contract violations: 1.
```

---

## `gen`

Scaffold a request stub for every operation in an OpenAPI spec. Each stub gets a
`status: 200` assertion and a [`spec` link](./file-format.md#spec-link), so the generated
collection starts at full drift-tracking with zero hand-wiring.

```
truspec gen --spec <openapi> --out <dir> [--base-url-var <name>]
```

| Flag | Alias | Description |
|---|---|---|
| `--spec <openapi>` | `-s` | **Required.** Path to the OpenAPI document. |
| `--out <dir>` | `-o` | **Required.** Directory to write the stubs into. |
| `--base-url-var <name>` | | Variable used for the base URL in generated URLs. Default `baseUrl`. |

Path parameters become template variables (`/pets/{id}` → `{{baseUrl}}/pets/{{id}}`).
Operations with an unsupported method are skipped and reported on stderr.

```bash
truspec gen --spec openapi.yaml --out ./api
# Generated 4 request(s) in ./api
```

---

## `import`

Convert an existing Postman or Bruno collection into `.tspec.yaml` files. See the
[Importing guide](./importing.md) for details and caveats.

```
truspec import <postman|bruno> <path> [--out <dir>] [--dry-run]
```

| Argument / flag | Alias | Description |
|---|---|---|
| `<postman\|bruno>` | | **Required.** Source format. |
| `<path>` | | **Required.** Postman collection JSON file, or a Bruno directory. |
| `--out <dir>` | `-o` | Directory to write converted files into. |
| `--dry-run` | | List what would be written without writing. |

Without `--out` (or with `--dry-run`), the command prints the files it *would* write — a
safe preview before committing to a destination.

```bash
truspec import postman ./postman_collection.json --out ./api
truspec import bruno ./bruno-collection --out ./api
truspec import postman ./postman_collection.json          # dry run (preview)
```

---

## `mock`

Start a local HTTP mock server that serves generated responses from an OpenAPI spec —
fully offline, no cloud. See the [Mock server guide](./mocking.md).

```
truspec mock --spec <openapi> [--port <n>] [--delay <ms>] [--validate]
```

| Flag | Alias | Description |
|---|---|---|
| `--spec <openapi>` | `-s` | **Required.** Path to the OpenAPI document. |
| `--port <n>` | `-p` | Port to listen on. Default `4000`. |
| `--delay <ms>` | | Artificial response latency, in milliseconds. |
| `--validate` | | Validate incoming requests against the spec (responds `400` on mismatch). |

The server runs until interrupted (Ctrl+C). Routes that aren't in the spec return `404`.

```bash
truspec mock --spec openapi.yaml                  # http://127.0.0.1:4000
truspec mock --spec openapi.yaml --port 5000 --delay 150 --validate
```

---

## `serve`

Open the local web UI for a collection. Requests execute **server-side** through the
engine (no CORS), and the UI is served from `@truspec/web`. See
[Editors](./editors.md#web-ui).

```
truspec serve [--dir <collection>] [--port <n>]
```

| Flag | Alias | Description |
|---|---|---|
| `--dir <collection>` | `-d` | Collection directory to serve. Default `.`. |
| `--port <n>` | `-p` | Port. Default `4100`. |

```bash
truspec serve --dir ./api       # opens http://localhost:4100
```

> Requires the web UI to be built. If you installed `truspec` from npm it's bundled; from
> a source checkout, build it with `pnpm --filter @truspec/web build` first.

---

## Tips

- **Everything is `--json`-able** (where it makes sense), so you can pipe TruSpec into
  `jq`, dashboards, or your own scripts.
- **Use `npx truspec …`** in CI to avoid a global install step.
- **Combine `run` + `drift` + `coverage` + `contract`** as gates in the same job — see the
  [CI guide](./ci.md).
