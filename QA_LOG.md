# QA_LOG — Adversarial hardening of TruSpec

Target: `/home/codewithrashid/opensource/truspec` (monorepo: `@truspec/core`, `truspec` CLI, `@truspec/mcp-server`, web, vscode).
Run: `pnpm test` (vitest, 25 files). Baseline before any work: **206 passed**.
Branch: `qa/adversarial-hardening`. Node 24, pnpm 9.15.4.

Stack: TypeScript, Zod-validated YAML collection format, custom interpolation / jsonpath / OpenAPI-subset
validator, Node `vm`-based pre/post scripts (explicitly *not* a security sandbox), local mock server,
Postman/Bruno importers. It is a local-first CLI/library, not a hosted service — so the highest-value
attack surface is **parsing untrusted bytes** (collection files, OpenAPI specs, imported collections,
HTTP responses) and the **correctness of the spec-sync / assertion engine**, not network load/chaos.

---

## Cycle 1 — discovery + first attack pass

### Plan
- Map build/test/run; establish green baseline (done: 206 passing).
- Attack the custom-implemented seams empirically with a scratch harness:
  - interpolation (deep nesting, cycles, ReDoS), jsonpath (malformed paths, prototype access)
  - OpenAPI response validator (recursive `oneOf`/`anyOf` blowup, circular `$ref`)
  - mock route precedence (static vs parametric), pathToRegex
  - format parse / importers (prototype pollution via `__proto__`, YAML edge cases)
  - confinePath traversal, secret masking gaps

### Findings

- [BUG-1] input/algorithmic-complexity (DoS) | severity **high**
  - Repro: `validateAgainstSchema(deepValue, {$ref:"#/.../S"}, doc)` where `S` is a recursive
    `oneOf`/`anyOf` whose branches `$ref` back to `S`, and `deepValue` is an N-deep nested object.
    Standalone timing (`/tmp/blowup.mts`) on the ORIGINAL code:
    `depth=10 66ms · depth=14 536ms · depth=16 1815ms · depth=18 7678ms · depth=20+ >60s (timeout)`
    — a clean doubling curve (≈ ×2 per depth level). A ~25-deep response hangs for minutes; deeper
    never returns. My broader scratch harness hung the whole vitest worker on this case.
  - Evidence: exponential timing above; reachable via `truspec contract` / `truspec run --spec`
    (and mock/coverage), where the *response* (often from the server under test, i.e. untrusted in a
    contract-testing scenario) is validated against a recursive spec. Recursive `oneOf`/`anyOf` are
    common in real specs (trees, comment threads, discriminated unions).
  - Root cause: `anyOf`/`oneOf` call `conforms(value, branch)` which fully re-validates the *same*
    value subtree per branch. With a self-`$ref` schema the work doubles at every level → O(2^depth).
    `MAX_DEPTH=100` bounds recursion *depth* but not the exponential *width* of re-validation below it.
  - Fix: memoize `conforms(value, schema)` by the identity of the value-node (WeakMap) and the
    schema-node (Map) for the duration of one top-level `validateAgainstSchema` call, so each
    (value, schema) pair is validated at most once. `packages/core/src/spec/validate-response.ts`.
    Post-fix timing (`/tmp/blowup2.mts`): `depth=18 4ms · depth=50 3ms · depth=500 2ms · depth=5000 2ms`
    — linear. Correctness preserved (oneOf "matches 2" / "matches 0" still reported).
  - Regression test: `packages/core/test/validate-response.test.ts` →
    "does not blow up exponentially on a recursive oneOf over a deep value" (30-deep value, <1000ms)
    + "still reports a violation deep inside a recursive oneOf" + "still flags a value matching two
    identical oneOf branches" (memo doesn't corrupt counting).
  - Suite after fix: PASS at the time (oneOf/anyOf). **NOTE: this fix was INCOMPLETE — see BUG-4**,
    which generalized the memoization to all recursion (allOf/properties/items).

- [BUG-2] API/contract — mock server route precedence | severity **medium**
  - Repro: an OpenAPI spec declaring `/users/{id}` *before* `/users/me`. `createMockResponder(spec)`
    then `respond("GET", "/users/me")` returned the `/users/{id}` example (`{kind:"byId"}`) instead of
    the literal route's (`{kind:"me"}`). Confirmed empirically in the scratch harness.
  - Evidence: `[mock-precedence] /users/me -> { kind: 'byId' }` (expected `me`).
  - Root cause: `respond()` did `routes.find(r => r.method===m && r.regex.test(path))` — the *first*
    route in document order that matches. A parametric route declared earlier shadows a later literal
    route, so the static endpoint is unreachable. (Real routers rank static > parametric.)
  - Fix: `packages/core/src/mock/engine.ts` — `respond()` now scans all matching routes and keeps the
    most specific via `compareSpecificity()` (literal segment beats `{param}` at the same position).
    Listing order of `responder.routes` is unchanged.
  - Regression test: `packages/core/test/mock.test.ts` → "mock route specificity" (both declaration
    orders: `/users/me` → literal, `/users/42` → parametric).
  - Suite after fix: **PASS — 211 tests (was 206; +5 new regression tests), 0 regressions.**

### Cycle outcome
- Broke? **yes** (2 bugs: BUG-1 high, BUG-2 medium) → both fixed with regression tests → full suite
  green (211 passed). Restart at Cycle 2 with a fresh attack pass over surfaces not yet probed.

---

## Cycle 2 — attack the spec-sync, importer, and HTTP-layer seams

### Plan
- Adversarial OpenAPI specs through `parseOpenApi` / `computeDrift` / coverage (weird `$ref`,
  missing pieces, status wildcards, huge docs).
- Bruno importer (`bru.ts`) on malformed `.bru` text.
- Mock HTTP server (`server.ts`): malformed URLs, odd methods, content-length spoofing.
- Live probe (`live.ts`): how it builds/sends URLs (SSRF surface, error handling).
- Validator edge cases beyond MAX_DEPTH; `additionalProperties` schemas; integer/number coercion.

### Findings

- [BUG-3] API/contract — response-schema validation false negative | severity **medium**
  - Repro: `validateAgainstSchema(123, { type: ["string", "null"] }, {})` returned `[]` (no
    violation). An array `type` — the idiomatic OpenAPI 3.1 / JSON Schema way to say "nullable" —
    was silently ignored, so the validator accepted ANY value for such a field.
  - Evidence: fuzz harness `/tmp/fuzz2.mts` → `type:["string","null"] vs number -> violations=0`.
  - Root cause: the type dispatch read `typeof schema.type === "string" ? schema.type : undefined`,
    so an array `type` became `undefined` → "any non-null value accepted". Same blind spot in the
    null guard (`schema.type === "null"` missed `type:[..., "null"]`).
  - Impact: a contract validator that silently passes wrong-typed responses defeats its purpose —
    a false negative on any OpenAPI 3.1 spec using union/nullable types. `truspec contract` /
    `run --spec` would report conformance for a non-conforming API.
  - Fix: `packages/core/src/spec/validate-response.ts` — the null guard now honors a `type` array
    containing `"null"`; a non-null value against an array `type` must satisfy at least one listed
    type (implemented as an implicit union via `conforms`, so sibling `properties`/`items` still
    apply). Single-string `type` behavior is unchanged.
  - Regression test: `packages/core/test/validate-response.test.ts` → "array type (OpenAPI 3.1 union
    types)" describe block (3 cases: nullable, plain union, object-arm with properties).
  - Suite after fix: **PASS — 214 tests (was 211, +3), 0 regressions.**

### Cycle outcome
- Broke? **yes** (BUG-3 medium) → fixed with regression tests → full suite green (214). Restart
  at Cycle 3.

---

## Cycle 3 — agent/network write surfaces + output encoding

### Plan
- MCP server create/update tools: do they confine writes to the workspace (path traversal via
  request name / dir)? schema validation before write?
- Web server (`truspec serve`): beyond the existing DNS-rebinding guard — path traversal on static
  assets / file reads, method handling.
- CLI JUnit XML output: are assertion messages / request names with `<`, `&`, `"`, control chars
  escaped (XML injection / malformed report)?
- Runner capture→chain edge cases.

### Findings
- **No new failures.** Every probed surface held:
  - JUnit XML output (`packages/cli/src/output.ts`): `escapeXml` escapes `<>&"'` AND strips C0
    control chars illegal in XML 1.0 — a hostile response header reaching a `<failure message>`
    can't break or inject the report.
  - MCP write tools (`packages/mcp-server/src/tools.ts`): `createRequest`/`updateRequest`/
    `scaffoldFromSpec` all route writes through `confinePath(cwd, …)` and validate against the
    schema before writing. Scaffold filenames come from `slug()` which strips every non-`[a-z0-9]`
    char (so a crafted `operationId` like `../../etc/x` collapses to `etc-x`), and files are flat —
    no traversal.
  - Web server (`packages/web/server/index.ts` + `api.ts`): empirically attacked the running server
    (`/tmp/webattack.mts`) with raw traversal, `%2e%2e` encoded traversal, double-encoding, a null
    byte (`%00`), backslashes, and API path params. Result: **no secret leak, no crash, server
    ALIVE**. URL normalization + decode→`normalize`→`startsWith(clientDir+sep)` guard + SPA fallback
    + `confinePath` on the API (throws → 500, no content) all hold. DNS-rebinding host guard returns
    403 for `Host: evil.com`. Encoded traversal → 403; null byte → existsSync returns false → SPA
    fallback (no crash).

### Cycle outcome
- Broke? **no** — cycle 3 found zero new failures. Proceed to a confirmation cycle with fresh,
  randomized inputs.

---

## Confirmation cycle — seeded property-based fuzzing

### Plan
- 60k randomized iterations (`/tmp/confirm.mts`, SEED=0x9e3779b9) over the riskiest engines, asserting
  no crash, no hang, always-terminates:
  - 20k random (recursive `$ref` schema incl. oneOf/anyOf/array-type/additionalProperties) × random
    JSON value → `validateAgainstSchema` (re-confirms the BUG-1 fix holds under random adversarial shapes).
  - 20k random jsonpath strings (incl. malformed `[`, `['`, `..x`, `.__proto__`, huge indices).
  - 20k random `{{template}}` strings through `interpolate` + `interpolateDeep`.

### Findings

- [BUG-4] input/algorithmic-complexity (DoS) — **incomplete fix of BUG-1** | severity **high**
  - How found: the seeded property-fuzz **hung** (no output, process pegged) on a randomly generated
    schema. The fuzz generates `allOf` parts plus recursive `$ref` — exactly the gap BUG-1's fix
    missed. This is the confirmation cycle doing its job: catching an incomplete fix.
  - Repro: `Node = { allOf: [ {properties:{next:$ref Node}}, {properties:{next:$ref Node}} ] }` over a
    deep value. Timing BEFORE this fix (BUG-1 fix in place): `depth=10 14ms · 14 108ms · 16 306ms ·
    18 1179ms` — still doubling. (`/tmp/alloftest.mts`.)
  - Root cause: BUG-1's fix memoized only `conforms` (the `oneOf`/`anyOf` path). `allOf`, `properties`,
    and `items` recurse through the **direct `validate` path**, which was NOT memoized — so `allOf`
    with two recursive parts still re-validated the same subtree per part → O(2^depth).
  - Fix: rewrote the validator around a single memoized `collect(value, schema)` that returns
    violations with paths *relative* to the subtree and is keyed by (value, schema) identity; callers
    `rebase` the relative paths onto their own position. ALL recursion (`$ref`, `allOf`, `oneOf`,
    `anyOf`, array-`type`, `properties`, `items`) now flows through `collect`, so every (value,schema)
    pair is validated at most once. `packages/core/src/spec/validate-response.ts`.
    Post-fix (`/tmp/verify4.mts`): `allOf depth=18 2ms · 100 0ms · 1000 0ms` — linear; nested paths
    (`/author/id`, `/b`, `/1`) and allOf constraint-merging verified intact.
  - Regression tests: `packages/core/test/validate-response.test.ts` → "does not blow up exponentially
    on a recursive allOf over a deep value" + "merges allOf parts and reports violations at the right
    path".
  - Suite after fix: **PASS — 216 tests (was 214, +2).**

- [BUG-5] input/algorithmic-complexity (DoS) — recursive schema vs **primitive / cyclic** value
  | severity **high**
  - How found: re-running the (hardened, progress-logging) confirmation fuzz **hung again** — reached
    iter 0, killed at 120s. Pinpointed by logging each schema before validating (`/tmp/findhang.mts`):
    offender = iteration 31.
  - Repro: `Node = oneOf[ oneOf[enum, {$ref:Node}], {$ref:Node} ]` validated against the **string**
    `"héllo"` → never returns. Also a **self-referential object value** (`value.next === value`).
  - Root cause: the BUG-1/4 memo caches only OBJECT values (primitives can't key a WeakMap), assuming
    "primitive leaves terminate". False under a RECURSIVE schema: a primitive re-validated against a
    `$ref`-cycle recurses through the *schema* graph with no value progress → 2^depth. A result cache
    can't break it — it's a CYCLE in (value, schema) space, populated only after a node that never
    finishes.
  - Fix: stack-based cycle detection (`visiting`: schema → set of values currently on the validation
    stack). Re-entering an in-flight (value, schema) pair = pure schema cycle → that subtree is treated
    as satisfied (breaks the loop). Works for primitives (value equality) and objects (identity); real
    recursive schemas over tree JSON descend into different value nodes so never self-collide.
    `packages/core/src/spec/validate-response.ts`. Verified (`/tmp/verify5.mts`): culprit 1ms, cyclic
    object 0ms; correctness (type / oneOf-count / nested-path) intact.
  - Regression tests: `packages/core/test/validate-response.test.ts` → "terminates on a primitive value
    against a self-referential oneOf" + "terminates on a self-referential (cyclic) object value".
  - Suite after fix: **PASS — 218 tests (was 216, +2), typecheck 7/7, 0 regressions.**

### Cycle outcome
- Broke? **yes** — the confirmation cycle exposed two genuine DoS gaps the unit suite missed (BUG-4
  allOf path, BUG-5 primitive/cyclic). Both fixed with regression tests. The validator now routes ALL
  recursion through one memoized + cycle-guarded `collect`, so termination is bounded by the number of
  distinct (value-node, schema-node) pairs — linear, no exponential or infinite path remains. A break
  during confirmation resets the loop: re-run the fuzz to completion, then a fresh confirmation cycle.

### Attacks that held (Cycle 2)
- `parseOpenApi` survives hostile docs (empty/null/array root, non-object paths/operations,
  unresolved & self-referential `$ref`) — throws a clean error or skips; never crashes.
- Bruno importer (`bru.ts`) survives malformed `.bru` (unbalanced braces, partial blocks, non-JSON
  bodies) — `extractBlocks` consumes to EOF, no infinite loop; bad input → warnings, not throws.
- **Mock HTTP server cannot be crashed** by malformed raw requests (`OPTIONS *`, `/%ZZ`,
  `//evil.com/x`, negative `Content-Length`): `new URL` normalizes odd targets and Node's parser
  rejects bad framing with 400 — server stayed ALIVE and served a valid request afterward.
- Live probe (`live.ts`) only issues GET/HEAD to the user-supplied base URL (no mutation, no
  injection beyond the operator's own `--live` argument).

---

## Confirmation cycles — both CLEAN

- **Confirmation #1** (`/tmp/confirm.mts`, SEED=0x9e3779b9, 60k iterations): after BUG-4 + BUG-5 fixes
  → validator 20k random (schema,value) pairs crashes=0 slowest=2ms; jsonpath 20k 0 hard-crashes;
  interpolate 20k slowest 1ms. **CLEAN.** (This run is what *found* BUG-4 then BUG-5 on earlier passes.)
- **Confirmation #2** (`/tmp/confirm-final.mts`, 5 FRESH seeds 0x1234567/0xdeadbeef/0xcafef00d/
  0x0badc0de/0x5eed5eed, 60k+ iterations, harder shapes — nested self-ref oneOf, direct `$ref` cycles,
  `additionalProperties`-as-schema, deeper recursion): globalSlowest=2ms, crashes=0, slow(>300ms)=0.
  **CLEAN.**

Two independent confirmation cycles across 6 distinct seeds, both zero failures → **STOP condition met.**

### Known subset limitations (documented; not changed — see Residual Risk)
- `additionalProperties` as a *schema* (vs `false`) is not enforced — extra properties go
  unvalidated. The validator doc explicitly scopes to `additionalProperties:false`. False negative
  only for specs that constrain extra-property *types*; recorded as residual risk.
- Beyond `MAX_DEPTH=100` recursion, `oneOf`/`anyOf` results degrade (the cutoff makes both branches
  trivially "conform"). Only reachable with ~30+ deep nested responses against recursive unions.

### Attacks that held (no bug — confirmed defensively)
- Prototype pollution: a collection file or OpenAPI doc with `__proto__`/`constructor` keys does NOT
  pollute `Object.prototype` (Zod builds fresh objects; `interpolateDeep` uses `Object.fromEntries`
  define-semantics; jsonpath/interpolate gate on `hasOwnProperty`). 
- jsonpath: malformed/hostile paths (`$..a`, `$[`, `$['a]`, `$.__proto__`, 5000-deep `.a` chains,
  huge indices) either throw a caught Error or return `[]` — never crash the process. `$.__proto__`
  returns `[]` (own-property guard).
- interpolate: 100k-template input resolves <1s (no ReDoS); `interpolateDeep` enforces its 256-level
  depth cap on hostile nesting and breaks reference cycles via WeakSet.

---

# FINAL SUMMARY

**Verdict.** Hardened the TruSpec engine against the failure classes that matter for a local-first,
spec-sync CLI: parser/validator robustness on untrusted bytes (collection files, OpenAPI specs,
imported collections, HTTP responses) and correctness of the spec-sync engine. **5 real bugs found
and fixed at the root, each with a regression test.** Final state: `pnpm test` **218 passed** (25
files; +12 over the 206 baseline), `pnpm typecheck` **7/7**, `pnpm build` **5/5**. Two independent
confirmation fuzz cycles across **6 seeds** produced zero failures. Confidence: **high** for the
engine/core; the network/agent surfaces (mock, web, MCP) were attacked empirically and held but
weren't load/chaos tested (not applicable to a local CLI — see gaps).

**Cycles:** 3 attack cycles + 2 confirmation cycles. Bugs by area/severity:
- Validator DoS (algorithmic complexity) — **3 bugs, high**: BUG-1 (oneOf/anyOf), BUG-4 (allOf/direct
  path — BUG-1's fix was incomplete), BUG-5 (primitive/cyclic value vs `$ref`-cycle schema).
- Validator false-negative (contract correctness) — **1 bug, medium**: BUG-3 (array `type` ignored).
- Mock server routing — **1 bug, medium**: BUG-2 (static route shadowed by earlier parametric route).

**Top fixes (root causes).**
1. **Response-schema validation was exponential / non-terminating** (BUG-1/4/5). A recursive
   `$ref` schema (`oneOf`/`anyOf`/`allOf` referencing itself) re-validated the same value subtree per
   branch → O(2^depth); for primitive or cyclic values it never terminated. Root cause: no memoization
   + no cycle detection. Fix: rewrote the validator so ALL recursion flows through one
   `collect(value, schema)` that (a) memoizes results by (value-node, schema-node) identity with paths
   kept relative + rebased per caller, and (b) breaks `(value, schema)` stack cycles via a `visiting`
   guard. Work is now bounded by the number of distinct (value, schema) pairs — linear. Reachable from
   `truspec contract` / `run --spec` where the response under test is attacker/bug-controlled.
2. **Array `type` silently accepted anything** (BUG-3). The OpenAPI 3.1 / JSON-Schema idiom
   `type: ["string","null"]` was ignored, so a contract check passed wrong-typed responses. Fix: a
   non-null value must satisfy at least one listed type (implicit union); null guard honors `"null"`.
3. **Mock static routes unreachable** (BUG-2). `respond()` returned the first regex match in document
   order, so `/users/me` declared after `/users/{id}` was shadowed. Fix: pick the most specific match
   (literal segment beats `{param}`).

**Coverage table.**
| Category | Status | Strongest attack survived |
|---|---|---|
| Functional / spec-sync engine | Tested | full unit suite (218) green; drift/coverage/contract logic reviewed |
| Input / fuzzing | Tested | 120k+ randomized validator/jsonpath/interpolate iterations across 6 seeds, 0 crashes/hangs |
| Algorithmic-complexity DoS | Tested | recursive `$ref` oneOf/anyOf/allOf + primitive/cyclic values — now linear |
| Parser robustness | Tested | hostile YAML/OpenAPI/`.bru`/Postman; prototype-pollution probes; no crash, no pollution |
| Path traversal / confinement | Tested | web static + API + MCP write + scaffold: raw/encoded/null-byte/backslash traversal → no leak |
| Output encoding | Tested | JUnit XML: `<>&"'` escaped + C0 control chars stripped (no injection) |
| Web server resilience | Tested | malformed raw HTTP, DNS-rebinding host guard, null bytes → no crash, server ALIVE |
| Secrets handling | Partially | masking reviewed (declared-secret scrub of url/headers/body/captures) — see gaps |
| Concurrency / races | Not tested | engine is single-shot per request; capture-chaining is sequential by design |
| Load / stress / soak / chaos | Not applicable | local-first CLI/library, not a hosted service |

**Residual risk & gaps.**
- **Secret masking** intentionally skips values `< 6` chars (documented) and only scrubs *reported*
  output fields; request auth headers aren't in results so aren't a leak vector. A short API key in a
  query string would surface unmasked — by design, but worth a doc note.
- **`additionalProperties` as a schema** (vs `false`) is not validated — a documented subset gap;
  extra-property *types* go unchecked (false negative for those specs only).
- **`MAX_DEPTH=100`**: beyond ~100 levels of schema recursion, results degrade (cutoff). The new cycle
  guard prevents the *hang*; the depth cap is now just a backstop for pathological non-cyclic depth.
- **Mock request-body detection** uses `Content-Length > 0`; a chunked (no length) body reads as
  "no body" for `validate:true`. Minor.
- Concurrency, true load/stress, and chaos/failure-injection were not exercised (out of scope for a
  local CLI; would need a service harness).

**Hardening recommendations.**
- Keep the new validator regression tests in CI (they encode the DoS + correctness invariants).
- Add the seeded property-fuzz (`/tmp/confirm*.mts`) as a scheduled CI job (cheap, catches future
  regressions in the validator's complexity guarantees) — port it into `packages/core/test` as a
  bounded fuzz with a fixed seed + time budget.
- Consider supporting `additionalProperties`-as-schema and OpenAPI `2XX` status wildcards to close
  remaining contract false-negatives.
- Add a doc note on the `< 6 char` secret-masking threshold.

**Artifacts.**
- Fixes: `packages/core/src/spec/validate-response.ts` (BUG-1/3/4/5), `packages/core/src/mock/engine.ts` (BUG-2).
- Regression tests: `packages/core/test/validate-response.test.ts` (+8 cases), `packages/core/test/mock.test.ts` (+2 cases).
- Repro / fuzz harnesses (scratch, in `/tmp`): `blowup.mts`, `blowup2.mts`, `alloftest.mts`,
  `findhang.mts`, `verify4.mts`, `verify5.mts`, `fuzz2.mts`, `mockcrash.mts`, `webattack.mts`,
  `confirm.mts`, `confirm-final.mts`.
- This log: `QA_LOG.md`.
