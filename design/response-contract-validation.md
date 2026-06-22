# Design: Response contract validation

> Status: **proposed** · Target: TruSpec v0.7 · Schema: additive (no `SCHEMA_VERSION` bump)
> Author: design draft · Last updated: 2026-06-23

## 1. Summary

Add the ability to validate a **real HTTP response against the OpenAPI response
schema** for the operation a request is linked to. Today TruSpec's spec-sync is
*structural*: `drift` checks that a request references an operation and supplies its
required params/body; `coverage` counts which operations have a test. **Nothing checks
that the response a server actually returns conforms to the contract.** This design
closes that gap with three coordinated surfaces:

1. A declarative assertion `{ type: schema }` — opt-in, per request.
2. Auto-validation in `truspec run --spec <openapi>` — every request with a `spec:`
   link gets its response validated, zero config.
3. A spec-framed CI gate `truspec contract --spec <openapi> <dir> --env <name>`.

All three share one engine. Fully offline, declarative, drops into CI with a non-zero
exit — consistent with `drift`/`coverage`/`mock`.

## 2. Motivation

### The competitive gap

The API-tooling market splits into two camps:

- **GUI clients** (Postman, Bruno, Insomnia) — great at authoring/sending, but spec-sync
  is weak or absent and is not a CI gate.
- **Spec/contract testing CLIs** (Schemathesis, Dredd, Portman) — strong at validating
  responses against a spec, but they aren't a git-native, human/agent-authored collection
  format.

TruSpec is the only tool claiming *spec-is-source-of-truth* **and** *git-native collection*
**and** *agent-native, offline*. But its strongest differentiator — "fail the build the
moment your code drifts from the spec" — is only half-true today: it catches **structural**
drift, not **behavioral** drift. Response contract validation makes the promise whole.

### Symmetry with what already exists

`packages/core/src/mock/engine.ts` already validates **requests** against the spec
(`MockResponderOptions.validate`, lines 158-197) and already walks the OpenAPI schema
subset to synthesize example bodies (`generateExample`, lines 56-94). Response validation
is the mirror image and reuses the same schema-walking machinery. This is a natural
completion, not a new pillar.

## 3. Goals / non-goals

**Goals**

- Validate response status, `content-type`, and body against the linked operation's
  OpenAPI response schema.
- Surface violations as ordinary assertion rows (CI exit code, `--json`, JUnit).
- Expose to agents via MCP and the JSON Schema.
- Zero new mandatory cloud/account/protocol surface. Offline-only.

**Non-goals (explicitly deferred — staying on-mission)**

- **No fuzzing / property-based test generation** (that's Schemathesis's lane; it would
  drift TruSpec toward a different product). We validate the responses of requests a human
  or agent *authored*.
- **No new protocols** (gRPC/WebSocket/SSE remain on the "deferred by design" list).
- **No request-body schema validation in the runner** — the mock server already covers
  request validation; the runner's job here is responses. (A future `--validate-request`
  flag could mirror this, but it is out of scope for v0.7.)

## 4. User-facing surface

### 4a. Declarative assertion

```yaml
# get-pet.tspec.yaml
name: Get pet by id
method: GET
url: "{{baseUrl}}/pets/{{petId}}"
assertions:
  - { type: status, equals: 200 }
  - { type: schema }                  # validate body against the spec's 200 response schema
spec:
  operation: "GET /pets/{id}"
```

`{ type: schema }` fields (all optional):

| field | meaning | default |
|---|---|---|
| `status` | which response's schema to validate against | the actual response status, else the matched 2xx |
| `contentType` | which media type's schema | `application/json` |
| `required` | fail if the spec declares **no** schema for this status | `false` (skip-with-note) |

The assertion is **spec-aware** — it resolves the schema from the OpenAPI document the
runner was given. If no spec is supplied to the run, the assertion reports a skip
("no spec provided"), never a hard failure, so a collection stays runnable without a spec.

### 4b. Auto-validation: `run --spec`

```bash
truspec run examples/blog --env local --spec examples/blog/openapi.yaml
```

Every request carrying a `spec:` link is validated against its operation's response schema
**without** needing an explicit `{ type: schema }` assertion. Adds one `schema` assertion
row per such request. Requests with no `spec:` link are unaffected.

### 4c. Gate: `truspec contract`

```bash
truspec contract --spec examples/blog/openapi.yaml examples/blog --env local
```

A spec-framed wrapper over `run --spec`: runs the collection, validates responses, and
prints a per-operation conformance report. Exits non-zero on any violation. This is the
command you put in CI next to `drift` and `coverage`.

Example output:

```
Contract — examples/blog vs openapi.yaml
  ✓ GET /posts            200  body conforms
  ✓ GET /posts/{id}       200  body conforms
  ✗ POST /posts           201  body: /author missing required property 'id'
  – GET /users/{id}       (no request — see `drift`)

2/3 tested operations conform · 1 violation
```

## 5. Design details (file by file)

### 5.1 `spec/openapi.ts` — extract response schemas

`SpecOperation` (lines 12-20) currently stops at `requestBodyRequired`. Extend it:

```ts
export interface SpecResponseSchema {
  status: string;                 // "200" | "201" | "default"
  contentType: string;            // e.g. "application/json"
  schema: Record<string, unknown>; // $ref-resolved JSON Schema (OpenAPI 3 subset)
}

export interface SpecOperation {
  // …existing…
  responses: SpecResponseSchema[]; // NEW: one entry per (status × json content type)
}
```

Add an `extractResponses(op, doc)` helper that mirrors `mock/engine.ts#pickResponse`
(lines 105-130) but keeps **all** statuses and resolves `$ref` on the schema node.
`resolveRef` already exists in both `openapi.ts` (lines 32-41) and `mock/engine.ts`
(lines 27-36) — **dedupe into `spec/openapi.ts` and import it from the mock engine** as
part of this change (small, removes the existing duplication).

A schema lookup helper:

```ts
export function responseSchemaFor(
  op: SpecOperation, status: number, contentType = "application/json",
): Record<string, unknown> | undefined
// exact status → "default" → undefined
```

### 5.2 New module `spec/validate-response.ts` — the validator

Signature:

```ts
export interface SchemaViolation { path: string; message: string; }
export function validateAgainstSchema(
  value: unknown, schema: Record<string, unknown>, doc: Record<string, unknown>,
): SchemaViolation[]   // empty array = conforms
```

**Validator choice (decision needed — see §9):** two viable options.

- **(A) Hand-rolled subset validator (recommended).** A recursive walker over the same
  OpenAPI-3 schema subset that `generateExample` already handles: `type`, `properties`,
  `required`, `items`, `enum`, `nullable`, `allOf`/`oneOf`/`anyOf`, `$ref`. ~150 LOC, **zero
  new dependencies**, and stylistically identical to the existing `generateExample` walker.
  Best fit for "refuse bloat" and for keeping the dependency surface tiny. Limitation:
  won't cover exotic JSON-Schema keywords (`patternProperties`, `if/then/else`,
  `dependentSchemas`), which are rare in hand-written OpenAPI response schemas.
- **(B) Ajv.** Full JSON-Schema fidelity, but adds a runtime dependency and needs an
  OpenAPI-3.0→JSON-Schema massage (`nullable: true` → `type: [..., "null"]`, strip
  unsupported keywords). OpenAPI 3.1 already aligns with JSON Schema 2020-12.

Recommendation: **ship (A)** for v0.7 (matches the codebase, no deps), and leave a clean
seam (`validateAgainstSchema`) so (B) can be swapped behind a flag later if a user hits a
keyword the subset validator doesn't cover.

### 5.3 `format/schema.ts` — new assertion variant

Add to the `Assertion` discriminated union (lines 60-88):

```ts
z.object({
  type: z.literal("schema"),
  status: z.number().int().optional(),
  contentType: z.string().optional(),
  required: z.boolean().optional(),
}),
```

**`SCHEMA_VERSION`: no bump.** Adding an optional assertion variant is **additive** — every
existing `.tspec.yaml` still parses unchanged, so it is not a breaking change under the
project's rule ("any breaking change bumps `SCHEMA_VERSION` and ships a migration"). The
only compat note: a *older* TruSpec binary (pre-0.7) will reject a file that uses
`{ type: schema }`, because the union is `.strict()`. That is normal forward-evolution, not
a break to existing files. Document it in the file-format changelog; keep `SCHEMA_VERSION`
at `0.1`. (If we later prefer to signal capability, bump to `0.2` then — but it isn't
required by the rule.)

Then regenerate the published JSON Schema: `pnpm gen:schema` (writes
`packages/core/schema/*.json`; never hand-edited). Update `format/types.ts` if the
assertion type is mirrored there.

### 5.4 `runner/assertions.ts` + `runner/run.ts` — evaluation

The existing `evaluateAssertion(a, res)` (assertions.ts:40) is **pure** over `ResponseView`
and deliberately spec-agnostic. The `schema` assertion needs context it doesn't have (the
resolved schema), so we do **not** widen that signature. Instead:

- Add an optional contract context to `RunContext` (run.ts:8-22):

  ```ts
  export interface RunContext {
    // …existing…
    contract?: {
      doc: Record<string, unknown>;        // parsed OpenAPI document (for $ref resolution)
      operation: SpecOperation;            // the matched op for THIS request
      auto?: boolean;                      // true when invoked via `run --spec` (no explicit assertion)
    };
  }
  ```

- In `runRequest` (run.ts:80), after building `view` (run.ts:156) and running the existing
  assertions (run.ts:157), evaluate response-schema validation:
  - If any `{ type: schema }` assertions exist → evaluate each via a new
    `evaluateSchemaAssertion(a, view, ctx.contract)` that resolves
    `responseSchemaFor(op, a.status ?? view.status, a.contentType)` and calls
    `validateAgainstSchema`. Produces `AssertionResult { type: "schema", ok, message }`.
  - Else if `ctx.contract?.auto` → synthesize one implicit `schema` check for the request.
  - No contract context and an explicit `{ type: schema }` → a skip row
    ("schema: no spec provided", `ok: true`) so spec-less runs don't fail.

`AssertionResult.type` is already `TruSpecAssertion["type"] | "script"` — it will now
include `"schema"` automatically once the union has the variant; no widening needed beyond
the schema change.

### 5.5 `workspace/run.ts` — wire the matched operation

The collection runner (`workspace/run.ts`) is where requests meet the spec. When a spec
path is supplied:

1. `parseOpenApi(specText)` once.
2. For each discovered request, find its matched `SpecOperation` using the **existing**
   `refMatchesOp` from `spec/drift.ts` (lines 27-32) — reuse, don't reimplement.
3. Pass `ctx.contract = { doc, operation, auto: true }` into `runRequest`.

This keeps the runner core decoupled: the *workspace* layer owns spec loading/matching; the
*runner* just validates against a schema it's handed.

### 5.6 `spec/report.ts` — `contractReport`

Add alongside `driftReport`/`coverageReport`:

```ts
export interface ContractReport {
  operations: number;
  conformed: string[];           // op keys whose response conformed
  violations: { op: string; status: number; problems: SchemaViolation[] }[];
  untested: string[];            // linked-but-no-request (defer to drift) — informational
  ok: boolean;
}
export async function contractReport(
  dir: string, specPath: string, opts: { env?: string; baseUrl?: string; /* fetch, timeout */ },
): Promise<ContractReport>
```

Unlike `driftReport` (static), this **sends requests** (it's `run`-shaped), so it takes the
same run knobs as `run` (env, fetch injection, timeout) and is `async`.

### 5.7 `cli` — `contract` command + `run --spec`

- New `packages/cli/src/commands/contract.ts`, structurally a clone of
  `commands/drift.ts` (parseArgs → resolve paths → call core → `emit` → exit code).
  Options: `--spec/-s` (required), `--env`, `--live`/`--base`, `--timeout`, `--json`,
  `--output/-o`. Register in `cli/src/index.ts` and add `formatContract` to `cli/output.ts`
  (mirror `formatDrift`).
- Extend `commands/run.ts`: add an optional `--spec` flag; when present, load+match and pass
  `contract.auto` per request. `run` without `--spec` is unchanged.

### 5.8 `mcp-server` — `truspec_contract` tool

In `packages/mcp-server/src/server.ts`, add a `truspec_contract` tool next to
`truspec_drift` (line 91) / `truspec_coverage` (line 106): inputs `dir`, `spec`, `env`,
optional `baseUrl`; returns the `ContractReport` JSON. Optionally add an optional `spec`
param to `truspec_run_collection` for parity with `run --spec`. Update the tool count
(README/docs say "10 tools" → 11) and `docs/mcp.md`.

## 6. Output & exit-code contract

- Each validated request gains exactly one `AssertionResult` with `type: "schema"`.
- `ok: false` on any violation → request fails → `run`/`contract` exit non-zero (same path
  as today's assertions; JUnit + `--json` get the rows for free).
- A missing schema for the response status: `required: true` → fail; otherwise a passing
  skip row with a clear message, so partially-documented specs don't block CI.

## 7. Testing plan

Co-located vitest specs (project convention):

- `spec/validate-response.test.ts` — conforming object; missing required prop; wrong type;
  `nullable`; `enum` mismatch; nested `$ref`; `allOf` merge; array items; extra props
  (allowed unless `additionalProperties:false`).
- `spec/openapi.test.ts` — `responses` extraction across multiple statuses, `$ref`
  responses, no-content responses, `default`.
- `runner/run.test.ts` — `{ type: schema }` pass/fail with injected `fetch`; `auto` mode;
  spec-less skip behavior; interaction with existing assertions.
- `cli/contract.test.ts` — exit codes, `--json` shape, `--env`, missing `--spec` usage.
- Extend `examples/blog` with one deliberately drifted response (behind the mock) to make
  the README "you should see N conform / 1 violation" loop demonstrable, mirroring the
  existing drift/coverage demo numbers.

## 8. Docs to update

`docs/spec-sync.md` (new "Response validation" section), `docs/cli.md` (`contract` +
`run --spec`), `docs/file-format.md` (the `schema` assertion), `docs/mcp.md` (new tool),
`docs/ci.md` (add `truspec contract` to the CI snippet), `README.md` roadmap
(move from "Next" / mention under spec-sync; add a comparison-table row "OpenAPI **response
contract** validation"), and `CLAUDE.md` (assertion-types list).

## 9. Open decisions for the human

1. **Validator: hand-rolled subset (recommended, zero deps) vs Ajv (full fidelity, +1
   dep).** §5.2.
2. **Surface scope for v0.7:** ship all three (assertion + `run --spec` + `contract`), or
   start with the assertion + `run --spec` and add the dedicated `contract` command in a
   follow-up?
3. **Strictness defaults:** should auto-validation treat extra/undocumented response
   properties as a violation (`additionalProperties` strict) by default, or only when the
   schema says so? (Recommend: honor the schema; don't impose strictness the spec didn't.)
4. **`SCHEMA_VERSION`:** keep `0.1` (additive — recommended) or bump to `0.2` to advertise
   capability?

## 10. Phasing

1. `openapi.ts` response extraction + `validate-response.ts` + tests (pure core; no surface).
2. `schema` assertion in the format + `gen:schema` + runner evaluation + `run --spec`.
3. `contract` command + `contractReport` + CLI output + example.
4. MCP tool + docs.

Each phase is independently shippable and leaves `main` green.
