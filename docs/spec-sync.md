# Spec sync: drift & coverage

This is the feature TruSpec exists for. Your OpenAPI document is the source of truth; your
collection is measured against it. Two checks — **drift** and **coverage** — keep them
honest, run fully offline, and fail the build the moment your collection rots away from
your API.

A third command, [`gen`](#scaffolding-from-a-spec), closes the loop by generating a
request stub for every operation so you start at full coverage.

---

## The model

A request links to a spec operation with a [`spec` block](./file-format.md#spec-link):

```yaml
spec:
  operation: "GET /pets/{id}"   # "${METHOD} ${path}"
  operationId: getPetById       # preferred when present
```

TruSpec parses your OpenAPI 3 document into a flat list of operations (keyed
`METHOD path`, e.g. `GET /pets/{id}`), then matches each request to an operation:

- If both have an `operationId`, they match on it.
- Otherwise the request's `operation` string is matched against the operation's
  `METHOD path` key.

Everything downstream — drift, coverage, the live probe — is computed from that matching.

---

## Drift

`truspec drift` diffs your collection against the spec and exits non-zero when they've
diverged. It reports four categories:

| Category | Meaning | Why it matters |
|---|---|---|
| **Untracked** (`added`) | In the spec, but no request references it. | A new endpoint shipped with no test. |
| **Stale** (`removed`) | Referenced by a request, but gone from the spec. | A request points at an endpoint that no longer exists. |
| **Changed** (`changed`) | Matched, but the request no longer satisfies the spec. | The contract tightened — e.g. a parameter became required — and the request didn't keep up. |
| **Missing from live API** (`liveMissing`) | With `--live`, a spec operation a running API doesn't serve. | The deployed API and the spec disagree. |

"Changed" currently fires when:

- the spec marks a **query parameter as required** and the request doesn't include it, or
- the spec marks the **request body as required** and the request has no body.

```bash
truspec drift --spec openapi.yaml ./api
```

```
Spec operations: 4   Collection operations: 3

Untracked in collection (1):
  + GET /users/{id}

Drift detected: 1 untracked, 0 stale, 0 changed.
```

The drift check passes (exit `0`) only when all four categories are empty.

### Probing a live API (`--live`)

Add `--live <baseUrl>` to also check a **running** API for operations it doesn't serve.
This catches the case where the spec and the deployment have diverged — the spec promises
an endpoint that returns 404/405, or the host is unreachable.

```bash
truspec drift --spec openapi.yaml ./api --live https://api.staging.example.com
```

For safety against a production target, the live probe **only sends `GET` and `HEAD`**
requests; mutating operations are skipped (and reported as skipped). Path parameters are
filled with `1` to form a concrete URL. An operation is flagged "missing from live API"
when the probe returns `404`, `405`, or the host is unreachable. Use `--timeout <ms>` to
bound each probe.

### JSON shape

`--json` emits a `DriftReport`:

```json
{
  "specOperations": 4,
  "collectionOperations": 3,
  "added": ["GET /users/{id}"],
  "removed": [],
  "changed": [],
  "liveMissing": [],
  "ok": false
}
```

---

## Coverage

`truspec coverage` reports what share of spec operations are exercised by a request **that
also has assertions** — a request with no assertions doesn't count, because it asserts
nothing about the contract.

```bash
truspec coverage --spec openapi.yaml ./api
```

```
Coverage: 75% (3/4 operations tested)

Uncovered (1):
  ✗ GET /users/{id}
```

Gate on a minimum with `--min`:

```bash
truspec coverage --spec openapi.yaml ./api --min 80   # exit 1 if below 80%
```

`percent` is `round(covered / total * 100)`; an empty spec reports `100%`. The command
exits `0` when `percent >= --min` (default `0`, i.e. report-only).

### JSON shape

```json
{
  "total": 4,
  "covered": ["GET /pets", "GET /pets/{id}", "POST /pets"],
  "uncovered": ["GET /users/{id}"],
  "percent": 75,
  "ok": true
}
```

---

## Scaffolding from a spec

`truspec gen` writes a request stub for **every** operation in your spec — each with a
`status: 200` assertion and a `spec` link already filled in. It's the fastest way to take a
brand-new spec to a fully drift-tracked collection.

```bash
truspec gen --spec openapi.yaml --out ./api
```

Each generated file looks like:

```yaml
tspec: "0.1"
name: getPetById
method: GET
url: "{{baseUrl}}/pets/{{id}}"
assertions:
  - { type: status, equals: 200 }
spec:
  operation: "GET /pets/{id}"
  operationId: getPetById
```

- Path parameters become template variables (`{id}` → `{{id}}`).
- The base-URL variable defaults to `baseUrl`; override with `--base-url-var`.
- File names are slugified from the `operationId` (or the `METHOD path` key).
- Operations with an unsupported HTTP method are skipped and reported.

After `gen`, flesh out the stubs (real assertions, bodies, auth) and your drift count drops
to zero. Agents can do this too — see the
[`truspec_scaffold_from_spec` MCP tool](./mcp.md#tools).

---

## A complete workflow

Put the three together and your API contract becomes a build gate:

```bash
# 1. Bootstrap a collection from the spec.
truspec gen --spec openapi.yaml --out ./api

# 2. Fill in assertions / bodies, then run against a mock or a real API.
truspec mock --spec openapi.yaml &
truspec run ./api --env local

# 3. Gate CI on the contract.
truspec drift    --spec openapi.yaml ./api          # no new/removed/changed endpoints
truspec coverage --spec openapi.yaml ./api --min 80 # enough of the surface is tested
```

When someone adds an endpoint to the spec, `drift` fails until a request covers it. When
someone makes a parameter required, `drift` flags the now-incomplete request. When the
deployed API and the spec disagree, `drift --live` catches it. That's the whole point: the
collection can't silently fall out of sync.

See the **[CI/CD guide](./ci.md)** to wire these into GitHub Actions and other pipelines.

---

## See also

- **[CLI reference](./cli.md#drift)** — every flag for `drift`, `coverage`, and `gen`.
- **[File format → Spec link](./file-format.md#spec-link)** — how requests reference
  operations.
- **[Programmatic API → spec](./api.md#spec--drift-coverage-openapi)** — compute drift and
  coverage from TypeScript.
