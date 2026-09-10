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
| [`init`](#init) | Scaffold a runnable collection: a request, an environment, a `.gitignore`. |
| [`run`](#run) | Run a request file or directory; non-zero exit on assertion failure. |
| [`drift`](#drift) | Diff a collection against an OpenAPI spec; non-zero exit on drift. |
| [`coverage`](#coverage) | Report which spec operations have a tested request. |
| [`contract`](#contract) | Run the collection and validate responses against the spec's schemas. |
| [`gen`](#gen) | Scaffold a request stub per operation from a spec. |
| [`codegen`](#codegen) | Render a request as a runnable snippet in another client or language. |
| [`lint`](#lint) | Static checks over a collection; non-zero exit on an error. |
| [`docs`](#docs) | Render a collection as committable Markdown documentation. |
| [`env`](#env) | List, inspect, or diff the workspace's environments. |
| [`import`](#import) | Convert a Postman/Bruno/Insomnia collection, curl command, or HAR. |
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

## `init`

Scaffold a collection that **runs** — not a skeleton that needs three more edits first.

```
truspec init [<dir>] [--spec <openapi>] [--dir <requests>] [--base-url <url>] [--env <name>] [--force]
```

| Flag | Alias | Description |
|---|---|---|
| `--spec <openapi>` | `-s` | Scaffold a request per operation instead of one placeholder. |
| `--dir <requests>` | | Subdirectory for requests. Default `api`. |
| `--base-url <url>` | | Base URL the generated environment points at. Default `http://localhost:3000`. |
| `--env <name>` | `-e` | Environment to create. Default `local`. |
| `--force` | | Overwrite files that already exist. |

It writes a folder config, a request, `environments/<env>.env.yaml`, a `.env.example`, and a
`.gitignore` rule for `.env` — so the first secret anyone adds is not committed. Re-running is
safe: existing files are reported and left alone.

With `--spec`, the whole loop is green offline on the first try, because the scaffold asserts the
status **the spec itself documents** and the generated environment declares every path parameter
the requests introduce:

```bash
truspec init --spec openapi.yaml
truspec mock openapi.yaml --port 3000 &
truspec run api --env local     # passes
```

---

## `run`

Run a single request file or a whole directory of requests, evaluating each request's
assertions.

```
truspec run <path> [--env <name>] [--spec <openapi>] [--var k=v] [--grep <re>] [--tag <name>]
                   [--bail] [--delay <ms>] [--json | --reporter <fmt>] [--output <file>] [--timeout <ms>]
```

| Flag | Alias | Description |
|---|---|---|
| `--env <name>` | `-e` | Environment to load (`environments/<name>.env.yaml`). |
| `--spec <openapi>` | `-s` | Validate each spec-linked request's response against the OpenAPI response schema. |
| `--var <name=value>` | | Override or add a variable. Repeatable; wins over the environment. |
| `--grep <regex>` | `-g` | Only run requests whose **name or path** matches (case-insensitive). |
| `--tag <name>` | | Only run requests carrying this [`tag`](./file-format.md). Repeatable (OR). |
| `--bail` | | Stop at the first failure; the remaining requests are reported as skipped. |
| `--delay <ms>` | | Pause between requests, for rate-limited APIs. |
| `--no-cookies` | | Send no cookies. By default a jar is shared across the run. |
| `--data <file>` | `-d` | Run the selection once per row of a CSV or JSON dataset. |
| `--repeat <n>` | | Run the selection `n` times (ignored when `--data` is given). |
| `--watch` | `-w` | Re-run whenever a request, environment, `.env` or spec file changes. |
| `--insecure` | `-k` | Skip TLS certificate verification (warns on stderr). |
| `--proxy <url>` | | Route requests through a proxy. |
| `--no-proxy <list>` | | Hosts that bypass `--proxy`, in `NO_PROXY` syntax. |
| `--ca <file>` | | Trust an extra CA certificate. Repeatable. |
| `--client-cert <file>` | | Client certificate for mutual TLS. |
| `--client-key <file>` | | Client key for mutual TLS. |
| `--client-key-passphrase <s>` | | Passphrase for an encrypted client key. |
| `--json` | | Shorthand for `--reporter json`. |
| `--reporter <fmt>` | | Output format: `human` (default), `json`, `junit`, or `html`. |
| `--output <file>` | `-o` | Write the report to a file instead of stdout. |
| `--timeout <ms>` | | Per-request timeout. Default `30000`. Use `0` to disable. |

**Data-driven runs.** `--data` runs the whole selection once per row, with the row's columns
available as `{{variables}}`. A JSON dataset carries types into a JSON body (see
[File format → Types in a JSON body](./file-format.md#types-in-a-json-body)); CSV cells are always
text:

```csv
# pets.csv
petId,expected
1,Rex
2,Fido
```

```bash
truspec run ./api --env local --data pets.csv
# [1] ✓ PASS  Get pet by id  (api/get-pet.tspec.yaml)  200 12ms
# [2] ✓ PASS  Get pet by id  (api/get-pet.tspec.yaml)  200  9ms
#
# 2 passed, 0 failed, 2 iterations, 2 total
```

CSV is parsed properly (quoted fields, embedded commas and newlines, `""` escapes, CRLF), and a
`.json` dataset is an array of objects. **Iterations are independent**: each starts from the same
variables with a fresh cookie jar, so row 2 never inherits row 1's captured ids or session. The
OAuth2 token cache *is* shared, since the credentials don't change between rows. Results carry
their 1-based iteration, which appears in the human log and in JUnit test names — without it, N
rows collapse into one testcase and a reporter shows only the last outcome.

An empty or missing dataset is an error, not a pass: a gate that never exercised the data it was
given has not passed.

**Watch mode.** `--watch` re-runs on every change to a request, environment, `.env`, or spec file
under the collection — the loop the plain-text format makes natural:

```bash
truspec run ./api --env local --watch
```

A burst of filesystem events from one editor save is debounced into a single run, a change arriving
*during* a run is coalesced into exactly one follow-up (rather than queueing runs faster than they
complete), and a run that throws is reported without ending the watch — a broken file is precisely
when you keep editing. Watch mode exits only on Ctrl-C, returning the last run's exit code.

<a id="transport-flags"></a>

**TLS and proxy are flags, never request fields.** Whether to trust a self-signed certificate or
route through a corporate proxy is a property of *where you are running*, not of the request — and
a committed file saying "skip TLS verification" is a liability that outlives the afternoon it was
needed. curl, git and every CI tool draw the line in the same place.

When redirects are followed, the run names the chain and says whether it ended because the server
stopped redirecting or because `maxRedirects` was reached — a bare `302` in a report otherwise reads
as the server's answer when it may be the third one:

```
✗ FAIL  R  (api/r.tspec.yaml)  302 26ms
      ↪ followed 1 redirect(s) — stopped at maxRedirects: http://127.0.0.1:4000/step1
```

```bash
truspec run ./api --env staging --ca ./corp-root.pem
truspec run ./api --proxy http://proxy.corp:8080
truspec run ./api --proxy http://proxy.corp:8080 --no-proxy localhost,127.0.0.1,.internal
truspec run ./api --client-cert ./client.pem --client-key ./client.key
```

`TRUSPEC_PROXY`, `HTTPS_PROXY`/`HTTP_PROXY`, `TRUSPEC_NO_PROXY`/`NO_PROXY` and
`NODE_EXTRA_CA_CERTS` are read from the environment so CI can configure them once; an explicit
flag wins per field.

The bypass list follows the convention curl and wget use: a comma-separated list where `*` means
never proxy, an entry may be a host, a `.suffix`, or a `host:port`, and a bare suffix matches on a
label boundary (`example.com` covers `api.example.com`, never `notexample.com`). It is what makes
your own dev server on `localhost` reachable while everything else still goes through the proxy.
The same flags and variables are accepted by [`serve`](#serve), so the web UI reaches the same
hosts the CLI does.
`NODE_TLS_REJECT_UNAUTHORIZED` is deliberately **not** honored — turning off verification should
be visible at the call site, not inherited from a variable someone set months ago for another
tool. `--insecure` always warns.

**Cookies.** A run shares one in-memory cookie jar, so a login request's session cookie is sent by
the requests that follow — including cookies set on a redirect hop. The jar is never written to
disk: a CI run must not inherit state from a previous one, and a session cookie is a credential
with no business in a repository. A request that sets its own `Cookie` header wins over the jar.
`--no-cookies` turns it off entirely.

The jar scopes cookies the way a browser does: loopback (`localhost`, `127.0.0.1`) counts as a
secure origin, so a dev server's `Secure` session cookie is sent back over plain http; a `Domain`
attribute with no dot in it (`Domain=com`) is refused rather than scoping the cookie to an entire
suffix; and the `__Host-` / `__Secure-` name prefixes are enforced, so a cookie whose name promises
host-only scoping is not stored with a `Domain`.

`--grep` and `--tag` combine as an **AND** (`--grep login --tag smoke` runs requests that match
both); repeated `--tag` flags combine as an **OR**. A selection that matches nothing exits `1`
with a message naming the filter — a filtered run that quietly passes because it ran zero requests
is the false positive this gate exists to prevent.

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
truspec run ./api --reporter html -o report.html  # standalone HTML artifact for a CI job
truspec run ./api --timeout 5000               # 5s per-request timeout
truspec run ./api --tag smoke --bail           # fast smoke gate: stop at the first failure
truspec run ./api --grep '^billing/'           # just one folder
truspec run ./api --var baseUrl=https://staging.example.com   # per-branch override in CI
truspec run ./api --delay 200                  # 200ms between requests (rate limits)
```

### Human output

```
✓ PASS  Get pet by id  (api/get-pet.tspec.yaml)  200 41ms
✗ FAIL  Create post    (api/create-post.tspec.yaml)  500 88ms
      ✗ status 500 fails == 201

1 passed, 1 failed, 2 total
```

With `--bail` or a filter, the summary says what did not run:

```
1 passed, 1 failed, 2 skipped (bailed), 4 total, 3 deselected
```

### HTML report

`--reporter html` writes one self-contained page: no external CSS, fonts, or scripts, so it
renders from a `file://` path, a CI artifact viewer, or under a strict CSP. It shows the verdict,
counts and total time, then a card per request with its assertions (failures first), captured
values, and a collapsible response (headers + body, truncated past 200 KB). Response bodies and
header values are attacker-controlled, so every interpolated value is HTML-escaped.

```yaml
# .github/workflows/api.yml
- run: npx truspec run ./api --env ci --reporter html -o report.html
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: truspec-report, path: report.html }
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

A result carries more than the happy path shows, and every field is optional — present only when
it applies:

| Field | When |
|---|---|
| `error`, `missingVars` | the request could not be sent; `{{names}}` that resolved to nothing |
| `missedCaptures` | a `capture` matched nothing — `{ name, source, reason? }` |
| `redirects`, `redirectLimitHit` | hops followed, and whether `maxRedirects` stopped the chain |
| `retries` | re-sends performed under `options.retries` — also printed in the human report (`↻ re-sent 2 time(s)`), because a 200 the server only gave on the third try is not a clean 200 |
| `scriptLogs` | what a `script` printed with `console.*` — `{ level, message }`, also printed in the human report under the request that produced it. Collected rather than written to stdout, so it works identically under the MCP server and in the browser |
| `iteration` | 1-based row index under `--data` / `--repeat` |
| `response.bytes` | body size as it arrived (not `bodyText.length`, which counts characters) |
| `response.binary`, `response.bodyBase64` | the body is not text; its real bytes, base64-encoded |
| `response.events`, `response.streamTruncated` | a `text/event-stream`'s parsed events, and whether the stream was cut short rather than finished by the server |
| `parseErrors` (top level) | files that did not parse, with the reason |
| `iterations`, `skipped`, `deselected` (top level) | data/repeat count, bailed, filtered out |

> **Secrets are masked.** Declared secret values are replaced with `***` throughout the
> output (URLs, bodies, headers, captured values, errors). See
> [File format → Environments](./file-format.md#environment-files).

### JUnit output

`--reporter junit` emits a JUnit `<testsuites>` document — one `<testcase>` per request —
that CI test reporters (GitHub Actions, GitLab, Jenkins, etc.) understand natively. Pair it
with `--output` to write a file the reporter can pick up.

**A `--bail`ed run reports every request it selected**, not only the ones that ran: those the bail
stopped before appear as `<skipped>` cases, and the suite carries a `skipped` count alongside
`tests` and `failures`.

```xml
<testsuites tests="5" failures="1" skipped="4">
  <testsuite name="truspec" tests="5" failures="1" skipped="4">
    <testcase name="R1" classname="r1.tspec.yaml" time="0.000">
      <failure message="…"/>
    </testcase>
    <testcase name="R2" classname="r2.tspec.yaml" time="0.000">
      <skipped message="not run — the run bailed at the first failure"/>
    </testcase>
    …
```

Without this a five-request run reported as a one-test suite and the four that never ran were
absent from the record — a dashboard showing a sliver of the truth. A file that failed to parse
appears as a failing case for the same reason: a report that omits something reads as clean.

A request excluded by `--grep`/`--tag` is *not* listed. That is a selection you asked for, not
something that failed to happen; the summary's `deselected` count says how many.

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
truspec gen <openapi> --out <dir> [--base-url-var <name>]
```

| Flag | Alias | Description |
|---|---|---|
| `<openapi>` | | **Required.** Path to the OpenAPI document (YAML or JSON). Also accepted as `--spec` / `-s`. |
| `--out <dir>` | `-o` | **Required.** Directory to write the stubs into. |
| `--base-url-var <name>` | | Variable used for the base URL in generated URLs. Default `baseUrl`. |

Path parameters become template variables (`/pets/{id}` → `{{baseUrl}}/pets/{{id}}`).
Operations with an unsupported method are skipped and reported on stderr.

```bash
truspec gen openapi.yaml --out ./api
# Generated 4 request(s) in ./api
```

---

## `env`

Inspect the workspace's environments without opening the files.

```
truspec env [<name>] [--dir <collection>] [--json]
truspec env --diff <a> <b> [--strict] [--json]
```

```bash
truspec env                               # every environment, with unresolved-secret warnings
truspec env prod                          # one environment's variables and secret status
truspec env --diff staging prod           # what differs
truspec env --diff staging prod --strict  # exit 1 if either declares a name the other does not
```

**Secret values are never printed** — only whether each resolves, and from where (the OS
environment or the project `.env`). This output goes into terminals and gets pasted into issues; a
tool that prints a token to help you debug a missing token has caused a worse problem than the one
it solved.

`--diff` exists for one boring failure in particular: staging declares a variable production does
not, so the collection runs green everywhere except where it matters. A name present on only one
side is reported as prominently as a changed value, and a name that is a plain variable on one side
and a secret on the other is flagged as the real difference in kind that it is. Names that are
secrets are marked `(secret)`, because the fix differs: a missing variable is added to the file, a
missing secret is set in the environment that runs it.

`--strict` turns it into a CI gate — exit 1 when either side declares a name the other does not.
Differing *values* never fail: environments are supposed to differ that way.

---

## `docs`

Render a collection as Markdown — endpoints, parameters, headers, bodies, auth, assertions,
captures, transport options, scripts, the linked spec operation, and a runnable example per
request. Every field a request file can carry reaches the document; a test holds that, so a new
field cannot ship undocumented.

```
truspec docs [<dir>] [--out <file>] [--title <text>] [--lang <target>|none] [--base-level <n>]
```

| Flag | Alias | Description |
|---|---|---|
| `--out <file>` | `-o` | Write to a file instead of stdout. |
| `--title <text>` | | Document title. Defaults to the directory name. |
| `--lang <target>` | `-l` | Example language ([any codegen target](#codegen)), or `none`. Default `curl`. |
| `--base-level <n>` | | Heading level to start at (1–5), for embedding in a larger page. |

**The output is deterministic** — no timestamp, no absolute paths, no run data. That is the point:
the document is meant to live next to the collection and be reviewed in a diff, and a
"generated on ⟨date⟩" line would make every regeneration a change, which is exactly how generated
docs stop being regenerated.

```bash
truspec docs ./api -o docs/api.md
git diff --exit-code docs/api.md   # CI: docs are up to date with the collection
```

A request carrying a [script](./scripting.md) gets a collapsed **Script** section with the source
and a warning, for two reasons: a `post` script's `tr.expect(...)` calls are assertions, so leaving
it out would make the **Asserts** list an incomplete account of what the request checks; and a
script runs with the same access as the `truspec` process, which is what a reader of a collection
they did not write needs to know before running it.

An unreadable file is reported *in* the document and on stderr, and does not fail the command —
[`lint`](#lint) is the command whose job it is to fail on a broken file.

---

## `lint`

Static checks over a collection — everything knowable **without sending a request**. `run` tells
you whether the API behaves; `lint` tells you whether the collection itself is sound.

```
truspec lint [<dir>] [--strict] [--json] [--disable <rule>] [--output <file>] [--list-rules]
```

| Flag | Alias | Description |
|---|---|---|
| `--strict` | | Also exit `1` on warnings. |
| `--json` | | Machine-readable report (every finding carries a stable `rule` id). |
| `--disable <rule>` | | Skip a rule. Repeatable. |
| `--output <file>` | `-o` | Write the report to a file instead of stdout. |
| `--list-rules` | | Print every rule with its severity and exit. |

| Rule | Severity | Catches |
|---|---|---|
| `parse` | error | The file does not parse against the schema. |
| `inline-secret` | error | A literal that looks like a real credential is committed in a request, a `folder.tspec.yaml` **or an `environments/*.env.yaml`** — including one embedded in a larger value, such as `Bearer <key>`. |
| `bad-jsonpath` | error | A capture or assertion uses a JSONPath the engine cannot parse — it would silently never match. |
| `no-assertions` | warning | The request asserts nothing, so a run can never fail on it. |
| `duplicate-name` | warning | Two requests share a name, making reports ambiguous. |
| `undeclared-var` | warning | A `{{var}}` no environment declares, no `.env` provides, and no *earlier* request captures. |
| `absolute-url` | warning | An absolute URL under a folder that sets `baseUrl` — switching environments would not move it. |
| `insecure-url` | warning | Plaintext `http://` to a host that is not the local machine. |
| `body-on-bodiless-method` | error | A `GET` or `HEAD` request carries a body. The HTTP client refuses to send it, so the request can never run. |
| `content-type-conflict` | warning | An explicit `Content-Type` names a different format than `body.type`. The header wins, so the body is sent under the wrong label. (A *narrower* type of the same format — `application/vnd.api+json` for a JSON body — is fine and is not flagged.) |
| `capture-never-used` | warning | A captured variable is referenced by no later request — usually a rename applied on only one side. |
| `script-runs-unsandboxed` | warning | The request carries a `script`, which runs with the same access as the `truspec` process — review it before running a collection you did not write. See [Scripting](./scripting.md). |
| `literal-credential-field` | warning | A field whose *name* says credential — `X-Api-Key`, `access_token`, `password`, `client_secret`, a query parameter of the same name written into the URL — holds a literal rather than a `{{variable}}`. `inline-secret` recognises a credential by its shape (a JWT, a Stripe key); this one recognises it by where it sits, which is the only clue an opaque token gives. Templates, values under 8 characters and obvious placeholders (`your-key-here`, `<token>`, `test`) are not flagged. |

**Exit code:** `1` if any error was found (or with `--strict`, any warning); otherwise `0`.

```bash
truspec lint ./api              # warnings are informational
truspec lint ./api --strict     # CI gate: nothing at all may be wrong
truspec lint ./api --json | jq '.findings[] | select(.severity=="error")'
```

Findings are grouped by file and carry the **line** they are about, so a report points at the code
rather than describing it:

```
api/things.tspec.yaml
   4  ! warning insecure-url: http://api.example.com/things is plaintext http:// to a remote host.
   7  ✗ error inline-secret: headers.X-Api-Key looks like an AWS access key id. Reference it as {{name}} and declare it under an environment's `secrets`.
  11  ! warning literal-credential-field: body.password holds a literal value…
```

They print in file order, and the same number is on each finding as `line` in `--json`. A rule that
is about the file as a whole rather than one field leaves the gutter blank and omits the field,
rather than pointing somewhere invented.

The `undeclared-var` rule understands the run's own ordering: a variable a request captures counts
as declared for every request that runs **after** it, and names a pre-request script sets with
`tr.set("name", …)` count for that request. Environments are found the way the runner finds them,
including nested collections, so linting a directory of several collections does not report every
variable as missing.

---

## `codegen`

Render a request as a runnable snippet in another HTTP client or language — for a bug report,
a README, a colleague on a different stack, or pasting into a terminal.

```
truspec codegen <request.tspec.yaml> [--lang <target>] [--env <name>] [--with-secrets]
                [--output <file>] [--list]
```

| Flag | Alias | Description |
|---|---|---|
| `--lang <target>` | `-l` | Snippet target. Default `curl`. |
| `--env <name>` | `-e` | Environment whose variables to substitute. |
| `--with-secrets` | | Also inline the values of declared **secrets**. Off by default — see below. |
| `--output <file>` | `-o` | Write to a file instead of stdout. |
| `--list` | | Print every supported target id and exit. |

**A declared secret keeps its `{{placeholder}}`, even with `--env`.** A snippet's whole purpose is
being shared — a bug report, a README, a colleague — and every other output surface
([run reporters](#reporters), [`env`](#env)) masks secret values. This one used to bake the resolved
credential into the URL, the `Authorization` header and the body:

```bash
$ truspec codegen api/me.tspec.yaml --env local
Note: apiToken left as {{placeholder}} — declared secret(s), and a snippet is made to be shared.
      Pass --with-secrets to inline the real value(s).

curl -X GET 'https://api.example.com/me' \
  -H 'Authorization: Bearer {{apiToken}}'
```

Variables that are *not* declared secrets still resolve normally, so the snippet is complete apart
from the credential. The note goes to **stderr**, so `-o snippet.sh` or a redirect gets clean
output. `--with-secrets` inlines them when you genuinely want a paste-and-run command.

The snippet is built through the **same resolution the runner uses**: the folder chain's
`baseUrl`, inherited headers, and auth are applied, and the environment's variables (including
secrets from your OS env or project `.env`) are substituted. Anything still unresolved is left
as its authored `{{name}}` placeholder rather than being silently blanked, so the reader can see
exactly what to fill in.

**Targets** (17): `curl`, `httpie`, `wget`, `powershell`, `javascript-fetch`, `javascript-axios`,
`python-requests`, `python-httpx`, `go`, `ruby`, `php`, `java`, `kotlin`, `csharp`, `rust`,
`swift`, `dart`.

```bash
truspec codegen api/get-pet.tspec.yaml --env local
# curl -X GET 'http://localhost:4000/pets/1?expand=owner' \
#   -H 'Accept: application/json' \
#   -H 'Authorization: Bearer {{token}}'

truspec codegen api/get-pet.tspec.yaml --lang python-requests --env local
```

The same generator backs the web UI's **code** button and the `truspec_codegen` MCP tool, so a
snippet is identical wherever you ask for it.

---

## `import`

Convert an existing Postman or Bruno collection — or a single `curl` command — into
`.tspec.yaml` files. See the [Importing guide](./importing.md) for details and caveats.

```
truspec import <postman|bruno|insomnia|curl|har> <path> [--out <dir>] [--dry-run] [--name <base>]
truspec import curl -            # read the command from stdin
```

For `curl`, the argument is the command itself when it isn't an existing file — so "Copy as cURL"
from browser devtools pastes straight in:

```bash
truspec import curl "curl 'https://api.example.com/pets' -H 'Authorization: Bearer abc'" --out ./api
```

Headers, query params and the body become structured fields; a bearer or basic `Authorization`
header (or `-u`) is lifted into an `auth` block; every imported request gets a
`{ type: status, lt: 400 }` assertion so it is runnable immediately. Flags with no request-file
equivalent (`-k`, `--proxy`, `-F` multipart) are reported as warnings rather than silently dropped.

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
truspec mock <openapi> [--port <n>] [--delay <ms>] [--validate]
```

| Flag | Alias | Description |
|---|---|---|
| `<openapi>` | | **Required.** Path to the OpenAPI document (YAML or JSON). Also accepted as `--spec` / `-s`. |
| `--port <n>` | `-p` | Port to listen on. Default `4000`. |
| `--delay <ms>` | | Artificial response latency, in milliseconds. |
| `--validate` | | Validate incoming requests against the spec (responds `400` on mismatch). |

The server runs until interrupted (Ctrl+C). A path the spec doesn't define returns `404`; a path
it does define, asked with a method it doesn't, returns `405` with an `Allow` header listing the
methods that are defined. `HEAD` is served from the matching `GET` operation — same status and
headers, no body — so you don't have to declare it in the spec.

```bash
truspec mock openapi.yaml                        # http://127.0.0.1:4000
truspec mock openapi.yaml --port 5000 --delay 150 --validate
```

---

## `serve`

Open the local web UI for a collection. Requests execute **server-side** through the
engine (no CORS), and the UI is served from `@truspec/web`. See
[Editors](./editors.md#web-ui).

```
truspec serve [<dir>] [--port <n>]
             [--insecure] [--proxy <url>] [--no-proxy <list>] [--ca <file>]
             [--client-cert <file>] [--client-key <file>] [--client-key-passphrase <s>]
```

| Flag | Alias | Description |
|---|---|---|
| `<dir>` | | Collection directory to serve. Default `.`. Also accepted as `--dir` / `-d`. |
| `--port <n>` | `-p` | Port. Default `4100`. |

It also accepts every [transport flag](#transport-flags) `run` takes, and reads the same
environment variables — so a host the CLI can reach is reachable from the UI too. Without
this, a collection that passes in CI against a self-signed staging box would fail in the
browser client, with nothing on screen to explain the difference.

```bash
truspec serve ./api            # opens http://localhost:4100
truspec serve ./api --ca ./corp-root.pem
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
