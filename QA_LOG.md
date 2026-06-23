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

---
---

# CAMPAIGN 2 — fresh adversarial pass (branch `qa/adversarial-cycle-2`)

The Campaign-1 stop condition was met and merged to `main`. Restarting the loop from scratch:
"it works" is a hypothesis to falsify. Baseline re-verified: `pnpm test` **218 passed** (25 files).
Strategy: aim at the surfaces Campaign 1 probed *least* — the **runner** (URL building, auth,
assertion regexes), **workspace** (folder/env/secret resolution), **drift/coverage** math, and the
**Postman/Bruno importers** — rather than re-grinding the response validator it already hardened.

## Cycle 1 — runner / resolve / importer attack pass

### Plan
- `resolveRequest`: URL building edges (fragments, pre-existing query, apikey-in-query), CRLF in
  header values, body encodings.
- Postman importer: 5k random hostile-JSON iterations — must never throw past its documented guard,
  and every emitted file must round-trip through `parse.*`.
- `generateExample` (mock) on self-referential `$ref` — must terminate.

### Findings

- [BUG-A] runner/URL building — query params silently swallowed by a URL `#fragment` | severity **medium**
  - Repro (empirical, `_qa_scratch.test.ts`): `resolveRequest({ url: "{{baseUrl}}/search#section",
    query: { q: "hello" } })` → `http://example.com/search#section?q=hello`. `new URL(...)` then parses
    `search=""` and `hash="#section?q=hello"` → **`searchParams.get("q") === null`**: the declared query
    param never reaches the server. Same class with a pre-existing query: `http://h/p?a=1#f` + `{b:2}` →
    `...?a=1#f&b=2` (b lost). And an `apikey in: query` auth param is silently dropped the same way →
    a request goes out **unauthenticated with no error or warning**.
  - Evidence: `[A1] does the server receive q? -> null`; `[A2] b= null`.
  - Root cause: `resolveRequest` did `url += (url.includes("?") ? "&" : "?") + qs`, appending the query
    string to the very end of the URL without accounting for an existing `#fragment`. Fragments are
    legal in a TruSpec `url` (the schema accepts any string), so query params get pushed into the hash.
  - Fix: `packages/core/src/runner/resolve.ts` — split the URL on the first `#`, insert the query
    string before the fragment, then re-append the fragment: `head + (head.includes("?")?"&":"?") + qs + frag`.
    Verified: `http://x/search#section` + `q=hello` → `http://x/search?q=hello#section` (param now in `search`).
  - Regression test: `packages/core/test/runner.test.ts` → 3 cases ("inserts query params before a URL
    fragment", "appends to an existing query string before the fragment", "places an apikey-in-query
    before a URL fragment").
  - Suite after fix: **PASS — 221 tests (was 218, +3), 0 regressions.**

### Attacks that held (Cycle 1)
- Postman importer (`importPostman`): 5000 random hostile-JSON collections (nested items, `__proto__`
  keys, unicode, control chars, oversized names) — **0 unparseable emitted files**; throws only its
  documented "Not a Postman v2.1 collection" guard on non-array `item`. Round-trip integrity holds.
- `generateExample` on a self-referential `$ref` schema (`Node.next -> Node`, `Node.kids[] -> Node`)
  terminates in **1ms** — the `depth > 6` cap bounds it (no infinite recursion; mock generation is safe).

### Cycle outcome
- Broke? **yes** (BUG-A medium) → fixed at root + 3 regression tests → full suite green (221).
  Restart at Cycle 2 with surfaces not yet probed this campaign.

---

## Cycle 2 — importer fuzz, mock regex, header injection, folder merge

### Plan
- Bruno importer: 6k random hostile-`.bru` iterations — never throw, every emitted request round-trips.
- Mock `pathToRegex`: adjacent-param paths (ReDoS?); CRLF in header values via the real fetch path;
  workspace folder-merge precedence + prototype pollution.

### Findings

- [BUG-B] mock/`pathToRegex` — catastrophic ReDoS on adjacent path params | severity **medium-high**
  - Repro (`_qa_scratch.test.ts` B2): a legal OpenAPI path with adjacent params (no literal separator)
    compiled to `([^/]+)([^/]+)…`. Matching a long non-matching request path:
    `/x/{a}{b}{c}{d}` → **17ms**, `/x/{a}{b}{c}{d}{e}{f}` → **1886ms** — a clean O(n^k) curve; 7–8
    adjacent params + a longer path hangs for minutes.
  - Evidence: `[B2] path=/x/{a}{b}{c}{d}{e}{f} … test_ms=1886`.
  - Root cause: `pathToRegex` emitted a separate `([^/]+)` per `{param}`; two+ adjacent unbounded greedy
    groups over the same class with no separator between them backtrack catastrophically when the `/?$`
    anchor fails. The mock matches **incoming request paths** (attacker-controlled) on the single Node
    event loop, so one crafted request stalls the whole server — a DoS. Adjacent params are legal
    OpenAPI (`/v{major}.{minor}.{patch}`, composite ids).
  - Fix: `packages/core/src/mock/engine.ts` — emit non-capturing `[^/]+` (the regex is only ever used
    for `.test()`, never `.exec()`) and **collapse a run of adjacent params into a single** `[^/]+`
    (adjacent params can't be uniquely split anyway). No two unbounded quantifiers ever sit adjacent →
    matching is linear. Post-fix the same paths compile to `^/x/[^/]+/?$` and match in **0–1ms**.
  - Regression test: `packages/core/test/mock.test.ts` → "mock adjacent-param path matching (ReDoS
    regression)": 8 adjacent params vs a 5000-char hostile path completes <100ms and returns undefined;
    a legit `/file/abcdefgh` still matches.
  - Suite after fix: **PASS — 223 tests (was 221, +2), typecheck 7/7, 0 regressions.**

### Attacks that held (Cycle 2)
- Bruno importer (`bruToRequest`): 6000 random hostile-`.bru` iterations — **0 throws, 0 round-trip
  failures**. `__proto__`/`constructor` header keys land as own properties (Object.fromEntries define
  semantics) — `Object.prototype` not polluted.
- CRLF / control chars in a header value reach undici's `Headers.append`, which throws; `runRequest`'s
  try/catch turns it into a clean `ok:false` result — **no crash, no unhandledRejection**.
- `mergeFolderConfigs`: precedence correct (leaf wins, root keys preserved); `__proto__` in folder
  headers stored as own property via spread — no prototype pollution.

### Cycle outcome
- Broke? **yes** (BUG-B medium-high) → fixed at root + 2 regression tests → full suite green (223).
  Restart at Cycle 3.

---

## Cycle 3 — response contract validator (untrusted-response correctness)

### Plan
- Hunt false-negatives in `validateAgainstSchema` (the flagship `contract` / `run --spec` engine that
  validates **untrusted API responses**): integer-vs-float, enum, required, and — the lead —
  composition keywords (`allOf`/`anyOf`/`oneOf`) as siblings of `type`/`properties`/`required`.

### Findings

- [BUG-C] spec/validate-response — composition keywords treated as mutually exclusive → silent
  false-negatives | severity **medium**
  - Repro (`_qa_scratch.test.ts` C1–C3, all returned `[]` = "conforms"):
    - C1 `allOf` sibling of `required:[id]`/`properties` + value `{name:"x"}` (missing `id`).
    - C2 `anyOf` sibling of `properties:{a:string}` + value `{a:123}` (a is a number).
    - C3 `allOf:[{$ref: Base}]` + own `required:[id]` (**the most common OpenAPI composition shape**) +
      value missing `id`.
    All three **passed a non-conforming response** — the contract check the tool exists to provide was
    silently skipped.
  - Root cause: in `validateInto`, the `allOf`/`anyOf`/`oneOf` blocks each ended with `return`, so any
    sibling `type`/`properties`/`required`/`items` constraints were never evaluated. JSON Schema
    keywords are **conjunctive** — every keyword present in a schema object is an independent constraint
    the value must satisfy simultaneously.
  - Fix: `packages/core/src/spec/validate-response.ts` — drop the early `return` from `allOf`/`anyOf`/
    `oneOf` so their violations accumulate and control falls through to the sibling type-dispatch.
    (`$ref`/`null`/`enum`/array-`type` keep their returns: array-`type` already folds siblings in via
    its `{...schema, type:t}` spread, and C1–C3 are fixed through the `allOf`/`anyOf` change. Verified
    no false positives: a fully-conforming value still returns `[]`, and pure-`allOf` schemas with no
    siblings are unchanged — C5 control.)
  - Regression tests: `packages/core/test/validate-response.test.ts` → "composition keywords are
    conjunctive with sibling constraints" (4 cases: sibling required+allOf, required+allOf:[{$ref}]
    incl. a conforming + a $ref-violating case, properties+anyOf, type+oneOf).
  - Suite after fix: **PASS — 227 tests (was 223, +4), typecheck 7/7, 0 regressions.**

### Attacks that held (Cycle 3)
- `integer` vs a float, `enum` membership, `required`, `additionalProperties:false` all flag correctly;
  the existing 29 validator tests still pass unchanged (the conjunction fix added strictness without
  introducing false positives).

### Cycle outcome
- Broke? **yes** (BUG-C medium) → fixed at root + 4 regression tests → full suite green (227).
  Restart at Cycle 4.

---

## Cycle 4 — broad property fuzz (5 seeds) — CLEAN

### Plan
- ~62k randomized iterations over the engines touched this campaign, guarding all three fix classes:
  D1 resolve (query-survives-fragment, BUG-A), D2 validator (conjunctive + recursive `$ref`/cycle
  termination, BUG-C), D3 mock `pathToRegex` (adjacent-param ReDoS, BUG-B), D4 jsonpath/interpolate.

### Findings
- **No new failures.** D1 crashes=0 **lostParams=0**; D2 crashes=0 slowest=**4ms**; D3 slowest=**2ms**
  on a 3000-char hostile path vs messy adjacent-param templates; D4 crashes=0.

### Cycle outcome
- Broke? **no** → proceed to a confirmation cycle with fresh seeds + an end-to-end integration attack.

---

## Confirmation cycle — fresh seeds + CLI integration

### Plan
- E0 `run` exit code on an empty target; E5 end-to-end capture-chain + secret redaction through the
  real `runCommand` against temp collection files.

### Findings

- [BUG-D] CLI/`run` — exits 0 when zero requests are found → silent green CI gate | severity **low-medium**
  - Repro (`_qa_scratch.test.ts` E0): `runCommand([emptyDir])` → **exit 0** with only a warning.
  - Evidence: `[E0] exit code for empty dir = 0`.
  - Root cause: `return result.ok ? 0 : 1`, and `result.ok = results.every(r => r.ok)` — `[].every()`
    is `true`. A misconfigured path / uncommitted files / bad glob (zero requests) therefore passes the
    gate. `run` is documented as a CI gate ("non-zero exit on failure"); a green build when nothing ran
    is the worst false-positive for a gate. (jest/pytest/go test all fail on "no tests found".)
  - Fix: `packages/cli/src/commands/run.ts` — treat zero requests as a failure: emit an **Error** (was
    Warning) and `return result.ok && !noRequests ? 0 : 1`. **Behavior change** (flagged for the
    maintainer): an empty run now exits 1. Scoped to `run` only — `contract` is documented as
    conformance-only (it delegates "untested" gating to `coverage`/`drift`), and `coverage`/`drift`
    already fail loudly on an empty collection (0% / all-added), so they need no change.
  - Regression test: `packages/cli/test/run.test.ts` → updated the prior "warns and exits 0 when no
    requests are found" (which asserted the buggy behavior) to "exits 1 (fails the CI gate) when no
    requests are found". This corrects a test that encoded the defect — a *strengthening*, not a
    weakened assertion.
  - Suite after fix: **PASS — 227 tests, typecheck 7/7, 0 regressions.**

### Attacks that held (confirmation)
- E5 end-to-end: capture-chaining propagated `Authorization: Bearer chaintoken999` to the second
  request, and secret redaction masked the declared `apiKey` in the `--json` output (no raw secret
  leaked, `***` present). The full pipeline (env/secret resolution → folder inheritance → chaining →
  redaction → reporters) is correct.
- **Real-world smoke (built binary + mock):** the README's documented blog flow produced exactly the
  advertised results with all fixes applied — `run` **3 passed/0 failed**, `drift` flags
  `GET /users/{id}`, `coverage` **75% (3/4)**. No false positives from the stricter validator on real
  specs (the shipped example specs use no composition keywords).

### Cycle outcome
- Broke? **yes** (BUG-D low-medium, found during confirmation) → fixed + test corrected → suite green
  (227). A break during confirmation resets the loop → restart at Cycle 5.

---

## Cycle 5 — fresh-seed fuzz + untrusted `.tspec.yaml` parse robustness — CLEAN

### Plan
- 5 fresh seeds (distinct from Cycle 4). F1 `parse.request` on ~30k random YAML/structured inputs
  (incl. `__proto__`, infinite-loop scripts, malformed YAML, control chars) — process must survive;
  F2 resolve query-survives-fragment; F3 validator/mock termination & ReDoS guards.

### Findings
- **No new failures.** F1 process survived all ~30k inputs (no crash/hang; parseable inputs round-trip);
  F2 crashes=0 lostParams=0; F3 validator crashes=0 slowest=**3ms**, mock regex slowest=**2ms**.

### Cycle outcome
- Broke? **no** → proceed to a final confirmation cycle with a 6th seed set + harder shapes.

---

## FINAL confirmation cycle — 6th seed set, harder shapes

### Plan
- G1 validator over a web of mutually-recursive schemas (every composition keyword + siblings +
  `additionalProperties:false`) × deep/cyclic values; G2 combined resolve + mock + **importers**
  (Postman + Bruno) round-trip under fresh seeds.

### Findings

- [BUG-E] importers/postman — `importPostman` crashes on a Postman item with an empty `name` | severity **medium**
  - How found: G2's combined importer round-trip reported **2215 failures** across ~9k iterations (G1 and
    the resolve/mock guards were all clean). Isolated to the Postman path with `name: ""`.
  - Repro: `importPostman({ item: [{ name: "", request: { method: "GET", url: "http://x" } }] })` →
    **throws** an uncaught Zod error and aborts the entire import. (`name: "***"` is fine — non-empty
    passes `min(1)`, and `slug` falls back to `request` for the filename.)
  - Root cause: `convertRequest` set `name = String(item.name ?? "Request")`; the `?? "Request"` fallback
    only fires for null/undefined, NOT for an empty string. The request schema requires `name.min(1)`
    (`schema.ts:118`), so serializing a `name: ""` request throws out of `importPostman` — and Postman
    exports legitimately contain empty request names, so `truspec import postman` crashes on real files.
  - Fix: `packages/core/src/importers/postman.ts` — `String(item.name ?? "Request") || "Request"` (the
    `|| "Request"` catches the empty-string result of any coercion: `""`, empty array, etc.). Applied the
    same guard to the imported folder-config name (`|| "Imported"`) for consistency. (Bruno was already
    safe: its name default uses a truthy guard, confirmed by the fuzz.)
  - Regression test: `packages/core/test/importers-variants.test.ts` → "an empty request name imports
    with a default instead of crashing the whole import".
  - Suite after fix: **PASS — 228 tests (was 227, +1), typecheck 7/7, 0 regressions.**

### Attacks that held (final confirmation)
- G1 validator: 30k iterations over mutually-recursive `A`/`B` schemas (allOf+$ref+required siblings,
  oneOf/anyOf cycles, `additionalProperties:false`) × deep/cyclic values — **crashes=0, slowest 12ms**.
  The conjunction fix (BUG-C) introduced no hang or false behavior under adversarial recursion.
- G2 resolve/mock: crashes=0, lostParams=0, mock regex slowest 2ms on a 5000-char hostile path.

### Cycle outcome
- Broke? **yes** (BUG-E medium, found in final confirmation) → fixed at root + regression test → suite
  green (228). A break during confirmation resets the loop → restart at Cycle 6.

---

## Cycle 6 — importer hard fuzz + broad sweep (7th seeds) — CLEAN

### Plan
- Hammer the importers (where BUG-E lived) with adversarial names (empty/whitespace/symbol/non-string
  types: number, null, false, `[]`, `{}`, `__proto__`), nested folders, hostile urls/bodies/auth, plus
  a broad resolve/validator/mock sweep.

### Findings
- **No new failures.** H1 importPostman ~10k iters: **THROWS=0, UNPARSEABLE=0** (BUG-E fix robust to all
  name types/structures). H2 bruToRequest ~15k: THROWS=0, round-trip=0. H3 sweep: resolve lostParams=0,
  validator crashes=0 slowest=12ms, mock regex slowest=17ms (bounded; a JIT/GC blip, re-measured below).

### Cycle outcome
- Broke? **no** → final confirmation cycle with an 8th seed set + an explicit ReDoS-linearity proof.

---

## FINAL confirmation #2 — 8th seeds + linearity proof — CLEAN

### Plan
- I1: prove the mock regex scales LINEARLY (10 adjacent params, 50×`test()` batches at path lengths
  1k→16k). I2: 8th-seed importer + validator + resolve sweep.

### Findings
- **No new failures.** I1: regex `^/x/[^/]+/?$`; 50×-batch timings `(1k,0ms)(2k,1ms)(4k,0ms)(8k,2ms)
  (16k,3ms)` — linear in length, O(n^k) gone for good. I2: postman parseFail=0, bruno parseFail=0,
  resolve lostParams=0, validator crashes=0 slowest=2ms.

### Cycle outcome
- Broke? **no.** Cycle 6 AND this confirmation both produced **zero new failures** across two distinct
  fresh seed sets → **STOP condition met.**

---

# CAMPAIGN 2 — FINAL SUMMARY

**Verdict.** Restarted the adversarial loop on the already-hardened (Campaign-1) engine and still found
**5 real, root-caused bugs**, each fixed with a regression test, plus a documented behavior change. They
cluster in the surfaces Campaign 1 probed least: request building, the mock matcher, the contract
validator's *correctness* (vs. its already-hardened *termination*), the CLI gate, and the Postman
importer. Final state: `pnpm test` **228 passed** (25 files; +10 over this campaign's 218 baseline, +22
over the project's original 206), `pnpm typecheck`/build **7/7**, and the README's documented blog flow
runs exactly as advertised in the built binary (`run` 3/3, `drift` flags `GET /users/{id}`, `coverage`
75%). Confidence: **high** for the core engine and CLI; the web/MCP network surfaces were hardened in
Campaign 1 and were not re-attacked here (noted as a gap).

**Cycles:** 6 attack cycles + 2 confirmation cycles (one per "clean" run, each interrupted by a tail bug
until the last). Bugs by area/severity:
- Request building (silent data loss) — **1, medium**: BUG-A (query params swallowed by a URL `#fragment`;
  also drops an `apikey in: query` auth param → request sent unauthenticated).
- Mock matcher (DoS) — **1, medium-high**: BUG-B (`pathToRegex` adjacent params → O(n^k) ReDoS on
  attacker-controlled request paths; 6 params + 64 chars already 1.9s).
- Contract validator (false-negative) — **1, medium**: BUG-C (composition keywords treated as mutually
  exclusive, not conjunctive → sibling `required`/`properties`/`type` skipped; the common
  `allOf:[{$ref}]`+own-`required` shape passed any response).
- CLI gate (silent pass) — **1, low-medium**: BUG-D (`run` exits 0 when zero requests found).
- Importer robustness (crash) — **1, medium**: BUG-E (`importPostman` throws on an empty request name).

**Top fixes (root causes).**
1. **Query lost to the fragment** (BUG-A) — appended the query string to the end of the URL, after any
   `#fragment`; now inserted before the fragment. `runner/resolve.ts`.
2. **Mock ReDoS** (BUG-B) — emitted a separate greedy `([^/]+)` per param; adjacent ones backtracked
   catastrophically. Now non-capturing and adjacent params collapse to one `[^/]+` → linear. `mock/engine.ts`.
3. **Validator false-negative** (BUG-C) — `allOf`/`anyOf`/`oneOf` short-circuited with `return`; removed
   so they accumulate and fall through to the conjunctive sibling type-dispatch. `spec/validate-response.ts`.
4. **Silent green gate** (BUG-D) — `[].every()` is `true`; `run` now treats zero requests as exit 1.
   `cli/commands/run.ts`. *(Behavior change — flagged for maintainer review.)*
5. **Importer crash on empty name** (BUG-E) — `?? "Request"` missed `""`; now `… || "Request"`. `importers/postman.ts`.

**Coverage table.**
| Category | Status | Strongest attack survived |
|---|---|---|
| Functional / spec-sync engine | Tested | full unit suite (228) + README blog flow in built binary |
| Input / fuzzing | Tested | ~250k randomized iterations across 8 seed sets (validator/resolve/mock/jsonpath/interpolate/parse) |
| Parser robustness (untrusted bytes) | Tested | ~35k Postman + ~30k Bruno + ~30k `.tspec.yaml` adversarial inputs — 0 crashes, 0 unparseable emits |
| Algorithmic-complexity DoS | Tested | mock `pathToRegex` proven linear to 16k-char paths; validator linear under recursive `$ref` |
| Contract correctness (false neg/pos) | Tested | conjunctive composition now enforced; no false positives on real specs |
| Request building correctness | Tested | fragment/query/apikey survival proven over 60k+ resolve iterations |
| CLI gate semantics / exit codes | Tested | empty/missing-env/bad-arg/failure exit codes all asserted |
| End-to-end integration | Tested | capture-chaining + secret redaction through the real `runCommand` |
| Concurrency / races | Not tested | engine is single-shot per request; capture-chaining is sequential by design |
| Load / stress / soak / chaos | Not applicable | local-first CLI/library, not a hosted service |
| Web `serve` / MCP network surfaces | Not re-tested | hardened in Campaign 1 (path traversal, DNS-rebinding, write confinement); out of scope this pass |

**Residual risk & gaps.**
- **BUG-D is a behavior change** (empty `run` now fails). Intentional and conventional (jest/pytest/go),
  but a maintainer who relied on empty-passes-green should review. Scoped to `run`; `contract` left as-is
  (documented conformance-only).
- The Campaign-1 residuals still stand: `additionalProperties`-as-schema unenforced; `< 6 char` secrets
  unmasked; `MAX_DEPTH=100` schema-recursion cutoff; chunked-body request detection in the mock.
- Web `serve` and the MCP server were **not** re-attacked this campaign (relied on Campaign 1). A future
  pass should fuzz the web save endpoint's body-size handling and the MCP tool error paths.
- Concurrency/load/chaos remain out of scope for a local-first CLI.

**Hardening recommendations.**
- Keep all new regression tests in CI (they encode: query-survives-fragment, mock-regex-linearity,
  validator-conjunction, empty-run-fails, importer-empty-name).
- Port the seeded property-fuzzes (resolve/validator/mock/importers) into a bounded, fixed-seed CI job —
  they found BUG-E in a single combined pass after targeted unit probes missed it.
- Consider enforcing `additionalProperties`-as-schema and OpenAPI `2XX` status wildcards to close the
  remaining contract false-negatives.

**Artifacts.**
- Fixes: `packages/core/src/runner/resolve.ts` (A), `packages/core/src/mock/engine.ts` (B),
  `packages/core/src/spec/validate-response.ts` (C), `packages/cli/src/commands/run.ts` (D),
  `packages/core/src/importers/postman.ts` (E).
- Regression tests: `packages/core/test/runner.test.ts` (+3), `mock.test.ts` (+2),
  `validate-response.test.ts` (+4), `importers-variants.test.ts` (+1),
  `packages/cli/test/run.test.ts` (corrected 1).
- Repro/fuzz harnesses were scratch vitest files under `packages/*/test/_qa_scratch.test.ts`
  (8 seed sets, ~250k iterations); removed after each cycle — their invariants live on in the
  regression tests above.
- This log: `QA_LOG.md`.

---
---

# CAMPAIGN 3 — third adversarial pass (branch `qa/adversarial-cycle-2`)

Re-entered the loop ("be skeptical of your own done"). Campaign 2 flagged honest gaps — the web `serve`
server, MCP tools, `scaffold`, the `--live` probe, and schema edge cases were NOT re-attacked. Campaign 3
aims there. Baseline re-verified: `pnpm test` **228 passed**.

## Cycle 1 — code-gen surfaces (scaffold / gen / MCP scaffold)

### Plan
- `scaffoldFromSpec`: hostile specs, colliding operationId/key slugs, filename safety.
- `confinePath` (web + MCP write confinement): symlink escape. `live.ts` SSRF surface.

### Findings

- [BUG-F] spec/scaffold — colliding filenames silently overwrite operations | severity **medium**
  - Repro (`_qa_repro.test.ts`): a 4-operation spec with case-variant operationIds (`getUser`/`GetUser`)
    and separator-variant paths (`/a-b` vs `/a/b`) → `scaffoldFromSpec` returns 4 file entries but only
    **2 distinct paths** (`getuser.tspec.yaml` ×2, `post-a-b.tspec.yaml` ×2).
  - Evidence: `[SCAFFOLD] files generated: 4 … COLLIDING filenames: ["getuser.tspec.yaml","post-a-b.tspec.yaml"]`.
  - Root cause: `scaffoldFromSpec` built `${slug(id)}.tspec.yaml` with no uniqueness tracking; distinct
    operations slug to the same base. `writeScaffold` then writes by name, so the second file overwrites
    the first on disk — silently dropping operations from a per-operation scaffold and making downstream
    `coverage`/`drift` wrong. Reachable via `truspec gen` and `truspec_scaffold_from_spec` (MCP).
    (The Postman importer already dedupes; scaffold didn't.)
  - Fix: `packages/core/src/spec/scaffold.ts` — track a `used` count per base slug and suffix `-2`/`-3`/…
    on collision, mirroring the importer.
  - Regression test: `packages/core/test/scaffold.test.ts` → "gives colliding slugs unique filenames so
    no operation is silently overwritten" (+ a baseline one-stub-per-op test).
  - Suite after fix: **PASS — 230 tests (was 228, +2), typecheck 7/7, 0 regressions.**

### Attacks that held (Cycle 1)
- `confinePath` follows symlinks via `realpathSync` (checks the deepest existing ancestor for not-yet-
  existing write paths) — a link inside the workspace can't point outside. Web write + MCP write confined.
- `live.ts` probe sends only GET/HEAD to the operator-supplied `--live` base (no mutation/injection).
- MCP read/run tools (`runCollectionTool`/`driftTool`/…) use bare `resolve()` (not confined) — a
  **defensible design choice** (an agent legitimately works across a user's projects; confining would
  break cross-dir use), unlike the web server which serves a single `dir`. Noted, not "fixed".

### Cycle outcome
- Broke? **yes** (BUG-F medium) → fixed at root + 2 regression tests → suite green (230). Restart Cycle 2.

## Cycle 2 — format schema strictness / contract conformance

### Plan
- Probe nested schema strictness (Body/Auth/Assertion/SpecLink) vs CLAUDE.md's "unknown keys are
  rejected" rule; numeric edges (`order` = NaN/±Inf; assertion numeric fields).

### Findings

- [BUG-G] format/schema — nested objects silently strip unknown keys (typos don't surface) | severity **low-medium**
  - Repro (`_qa_repro.test.ts`):
    - P1 `spec: { operatonId: getPet }` → parses to an empty `{}` spec link (typo stripped). `{}` is
      truthy, so the request is treated as spec-linked-to-nothing → `drift` mis-reports it as **stale**
      and `coverage` counts it uncovered — a silent mislink in the flagship spec-sync feature.
    - P2 `{ type: jsonpath, path: "$.id", exits: true }` → strips `exits`, leaving a condition-less
      assertion that silently **always fails**.
    - P5 control: top-level typos ARE rejected — confirming the inconsistency (top strict, nested not).
  - Root cause: `RequestSchema`/`FolderConfigSchema`/`EnvironmentSchema` are `.strict()`, but the nested
    `Body`/`Auth`/`Assertion`/`SpecLink` discriminated-union objects were not — so optional-key typos
    were silently stripped instead of rejected, contradicting CLAUDE.md's hard rule. Notably the PUBLISHED
    JSON Schema already declared `additionalProperties:false` on these objects (an editor/agent would
    flag the typo), so the Zod runtime was **out of sync with its own published contract**.
  - Fix: `packages/core/src/format/schema.ts` — add `.strict()` to every nested Body/Auth/Assertion
    member and to `SpecLink`. Regenerated the JSON Schema (`pnpm gen:schema`) → **no diff** (the published
    schema was already strict; this fix makes the runtime match it). (P3: required-field typos were
    already caught. P4: `order` rejects `.nan`; accepts `±.inf` which sorts deterministically — no fix.)
  - Regression test: `packages/core/test/format.test.ts` → "rejects unknown keys in NESTED objects too
    (assertion/spec/auth/body typos surface)".
  - Suite after fix: **PASS — 231 tests (was 230, +1), typecheck 7/7, JSON Schema unchanged, 0 regressions.**

### Cycle outcome
- Broke? **yes** (BUG-G low-medium) → fixed at root + regression test → suite green (231). Restart Cycle 3.

## Cycle 3 — broad fresh-seed sweep (9th seeds) — CLEAN

### Plan
- J1 `scaffoldFromSpec` over ~6k random hostile specs (collision-freeness, every stub parses);
  J2 strict-schema fuzz (~15k: nested typos rejected, valid requests still parse);
  J3 regression sweep (validator/resolve/mock under fresh seeds).

### Findings
- **No new failures.** J1 filename collisions=0, parseFailures=0; J2 crashes=0, acceptedNestedTypo=0,
  rejectedValid=0; J3 resolve lostParams=0, validator crashes=0 slowest=11ms, mock slowest=28ms (GC blip;
  regex is the collapsed `[^/]+`, proven linear in Campaign 2).

### Cycle outcome
- Broke? **no** → final confirmation cycle with a 10th seed set + a scaffold count-invariant.

## FINAL confirmation — 10th seeds + real-binary smoke — CLEAN

### Plan
- K1 scaffold count invariant (#files == #non-skipped ops, all distinct, all parse) over ~9k specs;
  K2 combined strict-schema/validator/resolve/importer sweep; plus a built-binary `gen`/`run`/`coverage`
  smoke (the strict-schema change must not break real example collections).

### Findings
- **No new failures.** K1 invariant violations=0; K2 typoAccepted=0, validRejected=0, validatorCrash=0
  slowest=3ms, resolveLost=0, importerFail=0. Built binary: `gen` on petstore → **3 distinct files**;
  blog `run` → **3 passed**; `coverage` → **75%**. No regression from the BUG-F/BUG-G fixes.

### Cycle outcome
- Broke? **no.** Cycle 3 AND this confirmation both produced **zero new failures** across two distinct
  fresh seed sets → **STOP condition met.**

---

# CAMPAIGN 3 — FINAL SUMMARY

**Verdict.** A third pass over the (twice-hardened) engine, aimed at Campaign 2's honest gaps (scaffold,
schema strictness, web/MCP confinement, the `--live` probe). Found **2 more real bugs**, both root-caused
and regression-tested. Final state: `pnpm test` **231 passed** (26 files; +3 this campaign over its 228
baseline, +25 over the project's original 206), `typecheck`/build **7/7**, JSON Schema regenerated with
**no diff** (the runtime now matches the already-strict published contract), and the README blog flow +
`gen` run exactly as advertised in the built binary. Confidence: **high** for the core engine, CLI, and
code-gen; the web/MCP HTTP/protocol layers were *reviewed* (confinement confirmed sound) but not load-
fuzzed (noted).

**Cycles:** 3 attack + 1 confirmation. Bugs by area/severity:
- Code-gen (silent data loss) — **1, medium**: BUG-F (`scaffoldFromSpec` colliding filenames overwrite
  operations on disk).
- Schema contract conformance (silent typo-stripping) — **1, low-medium**: BUG-G (nested Body/Auth/
  Assertion/SpecLink objects weren't `.strict()`, so optional-key typos were dropped instead of rejected —
  diverging from the published JSON Schema and yielding mislinked specs / no-op assertions).

**Top fixes (root causes).**
1. **Scaffold collisions** (BUG-F) — `scaffoldFromSpec` wrote `${slug}.tspec.yaml` with no uniqueness
   counter; distinct ops that slug alike overwrote each other. Now suffixes `-2`/`-3`/… like the importer.
   `spec/scaffold.ts`.
2. **Nested typo-stripping** (BUG-G) — `.strict()` added to every nested discriminated-union object and
   `SpecLink`, so typos surface as parse errors per CLAUDE.md's rule and the runtime matches the published
   JSON Schema. `format/schema.ts`.

**Coverage table (this campaign; see Campaigns 1–2 for the rest).**
| Category | Status | Strongest attack survived |
|---|---|---|
| Code-gen / scaffold | Tested | ~15k random hostile specs — 0 collisions, count invariant holds, every stub parses |
| Schema / contract conformance | Tested | ~30k fuzz — all nested typos rejected, no valid request falsely rejected; JSON Schema in sync |
| Path confinement (web + MCP write) | Reviewed | `confinePath` realpath-follows symlinks; deepest-ancestor check for writes |
| `--live` SSRF surface | Reviewed | GET/HEAD only to the operator-supplied base; no injection |
| Output formatters | Reviewed | JUnit escapes name/classname/message + strips C0; human/json over trusted data |
| Web `serve` / MCP load-fuzz | Not tested | reviewed only; would need a running-server harness (carried gap) |

**Residual risk & gaps.**
- MCP read/run tools are intentionally **not** path-confined (agents work across projects); the web API
  `POST /api/run` `env` name is likewise unconfined (loopback-only, local user) — both noted as design,
  not fixed.
- Web `serve` and MCP protocol layers were reviewed, not load/fuzz-tested (no server harness this pass).
- All Campaign 1–2 residuals stand (`additionalProperties`-as-schema, `<6`-char secrets, `MAX_DEPTH=100`).
- BUG-D's behavior change (empty `run` exits 1) still warrants maintainer review.

**Hardening recommendations.**
- Keep the new regression tests in CI (scaffold uniqueness, nested-key strictness).
- Add a CI check that `pnpm gen:schema` produces no diff (catches future Zod-vs-published-schema drift —
  exactly the class BUG-G fell into).
- A future campaign should stand up a web/MCP server harness and fuzz the live HTTP/protocol surface.

**Artifacts.**
- Fixes: `packages/core/src/spec/scaffold.ts` (F), `packages/core/src/format/schema.ts` (G).
- Regression tests: `packages/core/test/scaffold.test.ts` (+2), `packages/core/test/format.test.ts` (+1).
- This log: `QA_LOG.md`.

---
---

# CAMPAIGN 4 — live-server pass (branch `qa/adversarial-cycle-2`)

Closed the gap every prior campaign deferred: **stood up the real running servers** (mock HTTP, web
`serve`, MCP) and attacked them live, instead of only reviewing them. Baseline: `pnpm test` **231 passed**.

## Cycle 1 — live mock HTTP server

### Plan
- Start the real `startMockServer` and fire: a route whose spec status is out of HTTP range; malformed
  raw request targets; concurrent requests.

### Findings

- [BUG-H] mock server — uncaught exception / process crash on an out-of-range spec status | severity **med-high**
  - Repro (`_qa_scratch.test.ts` L0/L1): a spec response keyed `"20000"` → `respond()` returns
    `status: 20000`; a live `GET /bad` then **hangs the client** and throws an uncaught
    `Invalid status code: 20000` on the server (`res.writeHead(20000)` — Node only allows 100–999).
  - Evidence: `[L1] uncaughtException on server: Invalid status code: 20000`; the fetch times out.
  - Root cause: (1) `pickResponse` did `Number(chosen)` for any `/^\d+$/` status with no range check;
    (2) `mock/server.ts`'s handler — including its `setTimeout`-delayed `send` — had **no try/catch**
    (unlike `web/server/index.ts`), so the throw was uncaught → in production the process dies.
    Reachable via `truspec mock` and the `truspec_mock_start` MCP tool (agent/third-party specs).
  - Fix: `packages/core/src/mock/engine.ts` — clamp the status to 100–999, else fall back to 200.
    `packages/core/src/mock/server.ts` — wrap `new URL` and the (possibly delayed) `send` in try/catch,
    replying 400/500 instead of throwing, so no single request can crash the long-running process.
  - Regression test: `packages/core/test/mock.test.ts` → "mock server resilience (out-of-range status
    code)" (unit: status clamped to 200; live: server responds 200 + stays alive + no uncaughtException).
  - Suite after fix: **PASS — 233 tests (was 231, +2), typecheck 7/7, 0 regressions.**

### Attacks that held (Cycle 1)
- Malformed raw targets (`/%ZZ`, `/a%2`, `OPTIONS *`, `//evil.com/x`, backslashes) → `new URL` with a
  base normalizes them; server stays alive (the crash vector was the status code, not URL parsing).

### Cycle outcome
- Broke? **yes** (BUG-H med-high) → fixed at root + handler hardening + 2 regression tests → green (233).
  Restart Cycle 2.

## Cycle 2 — live web `serve` server + MCP tools

### Plan
- Web: 40 concurrent same-path saves (corruption); hostile API (bad JSON, traversal path, oversized
  body, wrong methods, env traversal); DNS-rebinding via raw sockets. MCP: hostile tool args.

### Findings

- [BUG-I] discovery — one malformed `.tspec.yaml` aborts the entire listing (undiagnosable) | severity **medium**
  - Repro (`_qa_scratch.test.ts` M4): `listCollections` over a dir containing one garbage `.tspec.yaml`
    **throws** `Nested mappings are not allowed…` — the whole listing fails and the error names no file.
  - Root cause: `listCollections` (MCP `truspec_list_collections`) and `buildState` (web `/api/state`)
    both `map(parse.request.parse(readFileSync(file)))` over all files with no per-file isolation. One
    typo'd file → the agent/UI can't list ANY request to even find the broken one, and the error carries
    no filename (an undiagnosable failure — itself a defect).
  - Fix: `packages/mcp-server/src/tools.ts` + `packages/web/server/api.ts` — per-file try/catch; valid
    requests still list, bad files become `errors: [{ path, error }]` entries (named, diagnosable).
  - Regression test: `packages/mcp-server/test/tools.test.ts` → "a malformed file does not abort the
    listing…"; `packages/web/test/api.test.ts` → "a malformed request file does not 500 /api/state…".
  - Suite after fix: **PASS — 235 tests (was 233, +2), typecheck 7/7, 0 regressions.**

### Attacks that held (Cycle 2)
- **Web server, comprehensive:** 40 concurrent saves to the same path → final file valid & complete, no
  corruption, no uncaught. Hostile API → traversal-path/folder-path/invalid-content/no-spec all return
  clean confined errors; wrong methods → 404; oversized 6MB body → cap enforced (server stays alive).
  **DNS-rebinding (raw sockets):** `Host: evil.com`/`8.8.8.8`/no-Host → **403**, loopback → 200.
- **MCP write/scaffold tools:** createRequest/updateRequest with traversal paths → confined (no escape
  to /etc or /tmp); invalid schema → clean `{ok:false}`; scaffold dedups colliding slugs (BUG-F holds).

### Cycle outcome
- Broke? **yes** (BUG-I medium) → fixed at root + 2 regression tests → green (235). Restart Cycle 3.

## Cycle 3 — live mock fuzz + core regression sweep

### Plan
- Fuzz the live mock server with adversarial status codes / shapes; sweep validator/scaffold/parse.

### Findings

- [BUG-J] spec/scaffold — crash on an operation with an empty-string operationId | severity **medium**
  - How found: the Cycle-3 sweep's `scaffoldFromSpec` call (not wrapped) threw on a generated spec.
    Isolated repro: `operationId: ""`.
  - Repro: `scaffoldFromSpec('… /x: { get: { operationId: "", responses: {…} } }')` → **throws** a Zod
    `name.min(1)` error, crashing `truspec gen` / `truspec_scaffold_from_spec` on the whole spec.
  - Root cause: `name: op.operationId ?? op.key` — `??` keeps an empty-string operationId, and an empty
    request `name` fails the schema. Same anti-pattern as BUG-E (Postman empty name).
  - Fix: `packages/core/src/spec/scaffold.ts` — `const label = op.operationId || op.key` for both the
    name and the filename slug; omit an empty operationId from the spec link
    (`operationId: op.operationId || undefined`). Audited the rest of the codebase for the same
    `?? ""`-feeds-`min(1)` pattern — no other instances (other `??` fallbacks feed no-min fields:
    auth, headers, display labels; the Bruno importer already uses a truthy guard).
  - Regression test: `packages/core/test/scaffold.test.ts` → "does not crash on an operation with an
    empty-string operationId (falls back to the key)".
  - Suite after fix: **PASS — 236 tests (was 235, +1), typecheck 7/7, 0 regressions.**

### Attacks that held (Cycle 3)
- Live mock servers with adversarial statuses ("20000"/"99"/"0"/"1000"/"default") → every route returns
  a writeHead-valid status, responds, and the server stays alive; no uncaughtException (BUG-H fix holds).
- Validator/parse-strictness/scaffold-dedup all clean under fresh seeds.

### Cycle outcome
- Broke? **yes** (BUG-J medium) → fixed at root + regression test + codebase audit → green (236).
  Restart Cycle 4.

## Cycle 4 — broad confirmation (5th seed set) — found an INCOMPLETE fix

### Plan
- Re-sweep every Campaign-1..4 surface under fresh seeds: scaffold (incl. empty/symbol operationIds),
  live mock servers with random statuses, importers, validator, strict-schema, resolve.

### Findings

- [BUG-K] mock server — a 1xx interim status served as the final response hangs clients (BUG-H fix was
  INCOMPLETE) | severity **medium**
  - How found: the live-mock sweep (O2/O2b) — refining the check to separate *fetch failures* from
    benign >599 statuses showed exactly one code, `"100"`, produced **fetchFailures=1** with no
    crash. `statusesSeen` was missing the 100 entry: the client hung until the 2s timeout.
  - Repro: a spec with response `"100"` (or `"101"`/any 1xx) → the mock sends `res.writeHead(100)` as
    the FINAL response; HTTP clients treat 1xx as interim and wait for the real response → `fetch` times
    out. (`"600"` returned fine — the fault is specific to 1xx, not the >599 range.)
  - Root cause: BUG-H's clamp used `[100, 999]` (Node's `writeHead` validity) — which still admits 1xx
    *interim* codes. A mock sends one COMPLETE response, so the valid range is the FINAL-status range
    `[200, 599]`; a 1xx is never a valid final response.
  - Fix: `packages/core/src/mock/engine.ts` — clamp to `[200, 599]`, else fall back to 200. Fixes both
    the writeHead crash (BUG-H) and the 1xx hang in one rule.
  - Regression test: `packages/core/test/mock.test.ts` → resilience block extended to assert 1xx
    (100/101/199) AND out-of-range (20000/99/0) all clamp to 200, a real 404 is preserved, and a live
    server with "20000" or "100" responds 200 (no crash, no hang).
  - Suite after fix: **PASS — 236 tests, typecheck 7/7, 0 regressions.**

### Attacks that held (Cycle 4, after the BUG-K fix)
- O1 scaffold (~7.5k specs, empty/symbol operationIds): THREW=0, collisions=0, parseFail=0.
- O2b live mock (13 adversarial statuses): fetchFailures=0, writeHead-invalid=0, uncaught=none.
- O3 importers/validator/resolve/strict-schema: importerFail=0, validatorCrash=0, resolveLost=0,
  typoAccepted=0, validRejected=0.

### Cycle outcome
- Broke? **yes** (BUG-K medium, an incomplete BUG-H fix surfaced in confirmation) → fixed at root +
  regression test → green (236). Restart Cycle 5.

## Cycle 5 — fresh-seed full sweep (6th seeds) — CLEAN

### Plan / Findings
- P1 mock engine over 27 status classes → invalid-final-status=0. P2 live mock over 12 status classes
  (1xx/6xx/20000/0/default) → fetchFailures=0, uncaught=none. P3 scaffold/importer/validator/resolve/
  strict-schema (~10k) → all zero. **No new failures.**

### Cycle outcome
- Broke? **no** → final confirmation with a 7th seed set.

## FINAL confirmation — 7th seeds + recursive-schema live mocks — CLEAN

### Plan / Findings
- Q1: 18 live mock servers under random {status × recursive/$ref schema}, draining each body →
  failures=0, uncaught=none (recursive-schema examples stay finite; no crash/hang). Q2: combined
  scaffold/importers/validator/resolve/strict sweep (~15k) → all zero. **No new failures.**

### Cycle outcome
- Broke? **no.** Cycle 5 AND this confirmation both produced **zero new failures** across two distinct
  fresh seed sets → **STOP condition met.**

---

# CAMPAIGN 4 — FINAL SUMMARY

**Verdict.** Closed the standing gap from Campaigns 1–3: **stood up the real running servers** (mock
HTTP, web `serve`, MCP) and attacked them live instead of reviewing them. That immediately paid off —
**4 more real bugs**, including a crash-the-process DoS and a client-hang, all root-caused and
regression-tested. Final state: `pnpm test` **236 passed** (26 files; +5 this campaign over its 231
baseline, +30 over the project's original 206), `typecheck`/build **7/7 / 5/5**, and the built binary
serves a hostile-status spec without crashing. Confidence: **high** across the engine, CLI, code-gen,
and now the live HTTP/MCP surfaces.

**Cycles:** 5 attack + 1 confirmation (BUG-K surfaced as an incomplete fix during confirmation, resetting
the loop). Bugs by area/severity:
- Mock HTTP server (crash + hang DoS) — **2**: BUG-H *med-high* (out-of-range status → uncaught
  `Invalid status code` → process crash) and BUG-K *med* (1xx interim status → client hang; BUG-H's
  clamp was incomplete).
- Discovery/observability — **1, med**: BUG-I (one malformed `.tspec.yaml` aborts the whole listing in
  `truspec_list_collections` / web `/api/state`, with no filename in the error).
- Code-gen robustness — **1, med**: BUG-J (`scaffoldFromSpec` crashes on an empty-string operationId —
  a sibling of Campaign-2's BUG-E).

**Top fixes (root causes).**
1. **Mock status crash + hang** (BUG-H/K) — `pickResponse` emitted any `Number(code)`; clamped to the
   valid FINAL range `[200,599]` (rejects out-of-range crashers AND 1xx interim hangers). Also wrapped
   the mock handler + its delayed `send` in try/catch so no single request can crash the process.
   `mock/engine.ts`, `mock/server.ts`.
2. **Listing aborts on one bad file** (BUG-I) — per-file try/catch in `listCollections` + `buildState`;
   valid requests still list, bad files become named `errors[]` entries. `mcp-server/tools.ts`, `web/api.ts`.
3. **Scaffold empty-operationId crash** (BUG-J) — `op.operationId || op.key` (not `??`); empty link omitted.
   `spec/scaffold.ts`.

**Coverage table (this campaign).**
| Category | Status | Strongest attack survived |
|---|---|---|
| Live mock HTTP server | Tested | ~30 live servers across every status class (1xx/2xx/3xx/4xx/5xx/6xx/20000/0/neg) + recursive schemas + raw malformed targets — no crash, no hang |
| Live web `serve` server | Tested | 40 concurrent same-path saves (no corruption); traversal/oversized/wrong-method API; DNS-rebinding via raw sockets (403) |
| MCP tools | Tested | traversal-confined writes; malformed-file listing resilience; invalid-schema clean errors |
| Concurrency (same-file writes) | Tested | 40 parallel POSTs → final file valid & complete |
| Observability / diagnosability | Tested | malformed file now surfaces with its path instead of an anonymous throw |
| Code-gen robustness | Tested | empty/symbol/missing operationIds + colliding slugs over ~25k specs |
| Load/soak (sustained high RPS, p99) | Not tested | no perf harness; would need k6/autocannon against a long-running instance |

**Residual risk & gaps.**
- **Oversized request body** to the web API returns a client connection-reset rather than a clean 413
  (server cap works and stays alive; cosmetic — `req.destroy()` races the 413 flush). Noted, not fixed.
- MCP read/run tools remain intentionally un-path-confined (cross-project agent use); web `/api/run`
  `env` name is unconfined (loopback-only). Design, not fixed.
- True **load/soak/p99** testing still not done (no perf harness) — the servers were correctness- and
  crash-fuzzed, not throughput-measured.
- All Campaign 1–3 residuals stand (`additionalProperties`-as-schema, `<6`-char secrets, BUG-D behavior
  change).

**Hardening recommendations.**
- Keep the new live-server regression tests in CI (mock status resilience, listing resilience).
- Add a scheduled load/soak job (autocannon) against `truspec serve` and `truspec mock` to catch leaks
  and throughput regressions the correctness fuzz can't.
- Consider a shared `safeHandler` wrapper for both HTTP servers so the try/catch posture can't drift
  apart again (BUG-H existed because the mock handler lacked the web server's guard).

**Artifacts.**
- Fixes: `mock/engine.ts` + `mock/server.ts` (H, K), `mcp-server/src/tools.ts` + `web/server/api.ts` (I),
  `spec/scaffold.ts` (J).
- Regression tests: `core/test/mock.test.ts` (+ resilience block), `mcp-server/test/tools.test.ts` (+1),
  `web/test/api.test.ts` (+1), `core/test/scaffold.test.ts` (+1).
- This log: `QA_LOG.md`.

---
---

# CAMPAIGN 5 — load/soak + runner HTTP-layer pass (branch `qa/adversarial-cycle-2`)

Closed the last category Campaign 4 deferred — **load / soak / leak** — and attacked the runner's HTTP
layer under adversarial *responses* (decompression bombs, slow-loris, resets). Baseline: **236 passed**.

## Cycle 1 — load/soak/leak + runner response handling

### Plan
- Load/soak the live mock + web servers (30k / 10k requests), watch RSS + handles for leaks.
- Runner vs hostile responses: gzip bomb, oversized body, slow-loris, mid-body reset, huge header.
- Functional: can a request observe a 3xx redirect?

### Findings

- [BUG-L] runner — auto-follows redirects → 3xx responses untestable & silently mis-reported | severity **medium**
  - Repro (`_qa_repro.test.ts`): a server returns `302 Location: /final`; `runRequest` reports
    **status 200** (the followed target), no `location` header → `assertions: [{status equals 302},
    {header location exists}]` both FAIL. A user "cannot test redirects", and `truspec contract`/
    `run --spec` can never validate a 3xx operation the spec declares (the flagship feature is blind
    to redirect responses).
  - Root cause: Node `fetch` defaults to `redirect: "follow"`, so the runner observes the redirect
    TARGET's response, not the response the requested URL actually returned.
  - Fix: `packages/core/src/runner/run.ts` — set `redirect: "manual"` in the fetch init. Node returns
    the real 3xx (status + `Location`), unlike a browser's opaque response (verified). Correct for a
    contract tool (matches curl's default). **Behavior change** (flagged for maintainer review): a
    collection that relied on auto-follow now sees the 3xx and its downstream assertions fail LOUDLY
    (not silently wrong) — a future per-request `followRedirects` opt-in could restore following.
  - Regression test: `packages/core/test/runner.test.ts` → "does not auto-follow redirects — a 3xx is
    observable and assertable" (asserts the runner passes `redirect:"manual"` and reports/asserts 302).
  - Suite after fix: **PASS — 237 tests (was 236, +1), typecheck 7/7, 0 regressions.**

### Attacks that held (Cycle 1)
- **Load/soak/leak — mock server:** 30k requests @ ~791 rps → heap stable (16→17-21MB, ~1MB growth, no
  monotonic leak), server responsive, no uncaught. 6k concurrent *delayed* (5ms) requests → 0 failures,
  no timer/handle leak. **Web server:** 10k `/api/state` + 200 concurrent same-path saves → no
  corruption, no crash, no leak; all failures under 64-concurrency were graceful client timeouts (0
  resets/errors).
- **Runner vs hostile responses:** an 80MB gzip **decompression bomb** is capped on the DECOMPRESSED
  stream (heap stayed 13MB — no OOM); oversized uncompressed body capped; **slow-loris body aborted at
  the timeout** (no unhandledRejection); mid-body connection reset → clean error; 200KB header → undici
  rejects cleanly. All return `ok:false` with a clean message; nothing crashes or hangs.

### Non-bug finding (documented, not fixed — honest call)
- **`/api/state` is O(collection-size) synchronous, event-loop-blocking work per request** (no cache):
  10 files→2ms, 500→205ms, 2000→468ms. Under 64-concurrency ~10% of requests hit the 5s client timeout
  (graceful — no crash/corruption/leak/reset). Realistic single-user use (≤100 files) is fine. The fix
  (cache parsed state + invalidate on write, and/or async fs) carries cache-staleness risk, so per
  "real fixes only / don't make it worse" it's recorded as a hardening recommendation, not forced.

### Cycle outcome
- Broke? **yes** (BUG-L medium) → fixed at root + regression test → green (237). Restart Cycle 2.

## Cycle 2 — broad confirmation (fresh seeds) — CLEAN

### Plan / Findings
- S1 runner observes every 3xx (301/302/303/307/308 → observed, not 200) — BUG-L holds. S2/S2b mock
  server 8k+24k requests with FORCED GC → heap stable 17MB (growth −1MB) = **no leak** (the un-GC'd
  100MB was just garbage). S3 broad core fuzz (validator/scaffold/importer/resolve/strict, ~12.5k) →
  all zero. **No new failures.**

### Cycle outcome
- Broke? **no** → final confirmation with fresh seeds.

## FINAL confirmation — fresh seeds + runner HTTP re-attack — CLEAN

### Plan / Findings
- T1 decompression bomb capped + slow-loris aborted, no unhandledRejection, heap 16MB. T2 redirect 307
  observed with Location intact (both assertions pass). T3 live mock all status classes (mockFail=0,
  uncaught=none) + broad fuzz (vCrash/scafBad/typo all 0). **No new failures.**

### Cycle outcome
- Broke? **no.** Cycle 2 AND this confirmation both produced **zero new failures** → **STOP met.**

---

# CAMPAIGN 5 — FINAL SUMMARY

**Verdict.** Closed the final deferred category — **load / soak / leak** — and attacked the runner's
HTTP layer under adversarial *responses*. The servers proved leak-free and crash-free under sustained
load; the runner already defeats decompression bombs, slow-loris, resets, and huge headers. One real
functional bug surfaced (redirect auto-follow) and one honest performance gap was documented (not
forced). Final state: `pnpm test` **237 passed** (26 files; +1 this campaign, +31 over the original
206), `typecheck`/build **7/7 / 5/5**. Confidence: **high** for correctness/crash-safety/leak-safety;
**partial** on raw throughput (measured latency/leak, did not push to a defined RPS SLO).

**Cycles:** 2 attack + 1 confirmation. Bugs by area/severity:
- Runner functional correctness — **1, med**: BUG-L (auto-follows redirects → 3xx untestable and
  `contract` blind to redirect operations).

**Top fix (root cause).**
- **Redirect auto-follow** (BUG-L) — Node `fetch` defaults to `redirect:"follow"`, so the runner reported
  the redirect TARGET's response. Set `redirect:"manual"` so a spec-contract tool observes the actual
  3xx (status + Location). `runner/run.ts`. *(Behavior change — flagged.)*

**Coverage table (this campaign).**
| Category | Status | Strongest attack survived |
|---|---|---|
| Load / soak / leak | Tested | 30k mock + 24k (forced-GC) + 10k web requests → heap stable (~17MB), no leak, no crash |
| Concurrency (same-file writes) | Tested | 200 concurrent same-path saves → final file valid & complete, no corruption |
| Runner vs hostile responses | Tested | 80MB gzip decompression bomb capped (no OOM); slow-loris aborted at timeout; reset/huge-header → clean errors |
| API/contract (status correctness) | Tested | redirect responses now observable + spec-validatable |
| Stress (sustained high RPS to a knee) | Partially | found `/api/state` O(n)-sync degrades under 64-conc (graceful timeouts); did not bisect the exact knee |
| Load to a defined throughput SLO | Not tested | no SLO defined for a local-first tool; would need autocannon + target RPS |

**Residual risk & gaps.**
- **`/api/state` is O(collection-size) synchronous per request** (10→2ms, 2000→468ms; event-loop-blocking).
  Fails gracefully (timeouts, no crash/leak/corruption). Documented as a hardening recommendation, not
  fixed — caching risks UI staleness. The realistic single-user case (≤100 files) is fine.
- **BUG-L is a behavior change** (no longer follows redirects). Correct for a contract tool; a future
  per-request `followRedirects` opt-in could restore following for users who want it.
- Raw throughput / defined-SLO load testing still not done (no perf harness / no SLO).
- All Campaign 1–4 residuals stand.

**Hardening recommendations.**
- Cache `/api/state` (parsed requests + spec list) and invalidate on write / via `fs.watch`; or move the
  reads off the event loop. Add a bounded-size guard for very large collections.
- Add an autocannon/k6 load+soak job in CI against `truspec serve` and `truspec mock` with a target RPS
  and a max-RSS-growth assertion (the correctness fuzz can't catch throughput regressions).
- Consider a `followRedirects` request option (default off) to make the BUG-L behavior configurable.

**Artifacts.**
- Fix: `packages/core/src/runner/run.ts` (L).
- Regression test: `packages/core/test/runner.test.ts` (+1, redirect).
- Load/soak + runner-response harnesses were scratch vitest files (removed); their invariants are
  recorded here and the redirect invariant lives on in the regression test.
- This log: `QA_LOG.md`.

---
---

# CAMPAIGN 6 — script vm / interpolation / env / capture / import pass — CLEAN

Targeted the surfaces 5 prior campaigns never *adversarially attacked* (only reviewed): the pre/post
script `vm` + `tr` API, capture→interpolation re-injection, env/secret resolution, `.env` parsing,
capture sources, the `import` writer, and `drift --live`. Baseline: **237 passed**.

## Cycle 1 — script vm + interpolation + env/secret + capture + import

### Plan / Findings — NO NEW FAILURES
- **Pre/post script vm (`tr` API):** every error path fails cleanly — bad hmac algo (`Invalid digest`),
  `throw`, `process`/`require` undefined (no sandbox escape, clean ReferenceError), syntax error, deep
  recursion (`Maximum call stack`), `tr.set` of objects/5MB strings. Infinite loops in BOTH pre and post
  scripts are killed at the 1s vm cap (post-script timeout empirically confirmed). No crash, hang, or
  unhandledRejection.
- **Interpolation re-injection:** a var/captured value containing `{{x}}` is NOT re-expanded
  (`{{a}}` with `a="{{secret}}"` → `"{{secret}}"`, not the secret) — single-pass, no template injection.
  `$&`/`$1`/`` $` `` replacement patterns stay literal (replacer is a function, not a string). Cyclic
  `interpolateDeep` input handled (WeakSet).
- **env/secret (`buildVars`):** OS-env secret correctly shadows a same-named variable; missing secrets
  reported; `__proto__` secret name does not pollute `Object.prototype`. **`.env` parsing:** quotes,
  `KEY=a=b=c`, comments, empty values, trim, last-dupe-wins, missing file → all correct.
- **capture sources:** jsonpath / case-insensitive header / status / object (JSON-stringified) all
  correct; missing path / missing header / malformed path → not captured (no crash).
- **`import` writer:** paths are `slug()`-generated (`[a-z0-9-]` only) → confined to `--out` by
  construction, no traversal; HEAD/OPTIONS/GraphQL requests resolve and run correctly.

### Cycle outcome — Broke? **no** → Cycle 2.

## Cycle 2 — drift --live + broad regression (fresh seeds) — CLEAN

### Plan / Findings — NO NEW FAILURES
- **`drift --live`** against a real server: probes **GET/HEAD only** (never POST /mutate — no side
  effects), classifies 404 → missing, skips mutating ops. Correct + safe.
- **Broad regression fuzz** (~12.5k iters, fresh seeds) over all 12 of this session's bug classes
  (A–L): validator crash/slow=0, scaffold collisions=0, importer fail=0, resolve lostParams=0, nested
  typo accepted=0, mock out-of-range/1xx status=0, redirect-followed=0. Every prior fix holds.

### Cycle outcome — Broke? **no** → confirmation cycle.

## FINAL confirmation — fresh seeds — CLEAN

### Findings — NO NEW FAILURES
- X1: ~1200 random pre/post scripts → crash/hang/unhandled=0, slowest 17ms. X2: ~18k interpolation
  iterations → failures/re-injections=0. X3: 10 live mock servers (all status classes) + ~10k broad
  fuzz → mockFail=0, uncaught=none, all guards 0.

### Cycle outcome — Broke? **no.** Two clean cycles + a fresh-seed confirmation → **STOP met.**

---

# CAMPAIGN 6 — FINAL SUMMARY

**Verdict.** The first **clean campaign**: attacked every remaining un-probed surface (script vm + `tr`
API, capture/interpolation re-injection, env/secret resolution, `.env` parsing, capture sources, the
import writer, `drift --live`, GraphQL, HEAD/OPTIONS) and a broad fresh-seed regression of all 17
historical bug classes — and produced **zero new failures** across two attack cycles and a confirmation.
Final state: `pnpm test` **237 passed** (26 files), `typecheck` **7/7**. Confidence: **high** for the
engine, CLI, code-gen, live servers, scripting, and runtime resolution.

**Cycles:** 2 attack + 1 confirmation. **Bugs found: 0.**

**Coverage table (this campaign).**
| Category | Status | Strongest attack survived |
|---|---|---|
| Scripting (vm / `tr` API) | Tested | ~1200 random pre/post scripts + targeted error paths (bad crypto, throws, undefined globals, infinite loops) — all clean, timeouts enforced |
| Input/fuzzing (interpolation) | Tested | ~18k random templates incl. nested `{{}}` re-injection + `$`-pattern injection — no expansion, no crash |
| Config/secrets | Tested | secret precedence, `__proto__` poisoning, `.env` quoting/dupes/edge cases |
| Capture / chaining | Tested | jsonpath/header/status/object/null/missing/malformed sources |
| Security (SSRF via `--live`) | Tested | live probe sends GET/HEAD only — never mutating methods |
| Import (file writing) | Tested | slug-confined paths (no traversal); idempotent overwrite on explicit `--out` |
| Regression (all 17 prior bugs) | Tested | fresh-seed sweep — every guard holds |

**Residual risk & gaps (unchanged from Campaign 5).**
- `/api/state` O(collection-size) synchronous cost per request (graceful timeouts under heavy
  concurrency; fine for realistic single-user use) — documented hardening recommendation, not a bug.
- Defined-SLO throughput load testing still requires a perf harness (autocannon/k6) + a target RPS.
- BUG-D (empty-run exit 1) and BUG-L (redirect no-follow) remain flagged behavior changes for review.

**Hardening recommendations (unchanged).** Keep all regression tests in CI; add a `pnpm gen:schema`
no-diff check; add a scheduled autocannon load/soak job; consider a `followRedirects` request option.

**Artifacts.** No code changes this campaign (zero bugs). Attack harnesses were scratch vitest files
(removed); their invariants are covered by existing regression tests. This log: `QA_LOG.md`.

---
---

# CAMPAIGN 7 — web UI client + browser-security pass (branch `qa/adversarial-cycle-2`)

Closed the one category marked "if applicable / not tested" for six campaigns: the **rendered web UI
client** and **browser-side security** (XSS, CSRF, clickjacking). Baseline: **237 passed**.

## Cycle 1 — web client XSS + CSRF/clickjacking

### Plan
- Render malicious collection data (request name/url/headers/docs = `<img onerror>`, `<script>`,
  `<svg onload>`) in the real UI; probe the `serve` server for CSRF / framing.

### Findings

- [BUG-M] security/CSRF + clickjacking — a malicious site can force-run the user's collection | severity **med-high**
  - Repro (empirical, against a live `truspec serve`): a cross-origin **"simple" POST** (text/plain
    body, which skips the CORS preflight) `POST /api/run` with `Origin: http://evil.com` returns
    **HTTP 200 and executes the collection** (run results in the body). Separately, the served UI has
    **no `X-Frame-Options`/CSP**, so a hidden `<iframe src="http://127.0.0.1:<port>/?run=all">` loads
    the UI and the `?run=all` deep-link auto-executes the whole collection.
  - Evidence: `Origin: http://evil.com POST /api/run -> HTTP 200`; `X-Frame-Options: NONE — framable`.
  - Impact: any site the user visits while `serve` is running (default port 4100, guessable) can trigger
    their collection — including mutating requests (POST/PUT/DELETE) — to fire against real APIs with
    real env secrets. Responses aren't exfiltrated (cross-origin opaque + the Host/DNS-rebinding guard),
    but the *actions* fire without consent. Classic localhost dev-server CSRF.
  - Root cause: the server validated the **Host** header (DNS-rebinding defense) but never the
    **Origin** header, and `POST` bodies are parsed regardless of content-type (so a no-preflight
    simple request reaches the handler). No anti-framing headers either.
  - Fix: `packages/web/server/index.ts` — (1) `originAllowed()` guard: when bound to loopback, reject any
    request whose `Origin` is present and not loopback (and `Origin: null`); allows same-origin (loopback
    Origin) and origin-less non-browser clients (curl/CI/MCP). (2) Set `X-Frame-Options: DENY` +
    `Content-Security-Policy: frame-ancestors 'none'` on every response. Both needed: the Origin check
    kills the direct cross-origin fetch; the frame headers kill the iframe-auto-run (whose post-load
    fetches would be same-origin).
  - Regression tests: `packages/web/test/server.test.ts` → "refuses a cross-origin POST to the API",
    "allows same-origin and origin-less API requests", "sends anti-framing headers on every response".
  - Suite after fix: **PASS — 242 tests (was 237, +5 incl. XSS), typecheck 7/7, 0 regressions.**

### Attacks that held (Cycle 1)
- **Web UI is XSS-safe.** Malicious collection data (`<img onerror>`, `<script>`, `<svg onload>`,
  `</pre><script>`, `"><iframe>`) rendered through every pattern the client uses (request name, url,
  docs, spec link, response body, assertion message, captured values, header KV) is **escaped by React**
  — proven empirically via `renderToStaticMarkup` (raw executable forms never appear; `&lt;`/`&gt;` do).
  The source has **zero** `dangerouslySetInnerHTML`/`innerHTML`/dynamic-`href`/`src` sinks (the bundle's
  occurrences are React internals). Kept as a permanent invariant: `packages/web/test/xss.test.ts`.

### Cycle outcome
- Broke? **yes** (BUG-M med-high) → fixed at root (Origin guard + anti-framing) + 3 regression tests,
  plus 2 permanent XSS-invariant tests → green (242). Restart Cycle 2.

## Cycle 2 — CSRF re-attack (all endpoints) + broad core regression — CLEAN

### Plan / Findings — NO NEW FAILURES
- Cross-origin attack on all 6 API endpoints × 5 hostile origins (incl. bypass tries
  `localhost.evil.com`, `127.0.0.1.evil.com`, `null`): **30/30 blocked (0 leaks)**; same-origin works
  6/6; origin-less (curl/CI) works; `X-Frame-Options: DENY` on every response.
- Broad core regression (~18k iters, fresh seeds) over all 18 bug classes: vCrash=0, scaffold=0,
  importer=0, resolveLost=0, strict-typo=0, mockStatus=0, re-injection=0.
- (Process note: an early scratch harness's same-origin `POST /api/request` wrote a stray
  `examples/petstore/x.tspec.yaml` — caught by the petstore count tests, removed; scratch writes now
  target temp dirs only. Not an app defect.)

### Cycle outcome — Broke? **no** → final confirmation.

## FINAL confirmation — fresh seeds — CLEAN
- 7th seed set over validator/scaffold/mock-status/resolve/strict-schema (~15k): all guards 0.
- Broke? **no.** Cycle 2 + confirmation both clean → **STOP met.**

---

# CAMPAIGN 7 — FINAL SUMMARY

**Verdict.** Closed the last untested category — the **rendered web UI + browser-side security**. The
UI proved **XSS-safe** (React escaping, no dangerous sinks — now locked by a permanent test), but a real
**localhost CSRF + clickjacking** hole was found and fixed. Final state: `pnpm test` **242 passed**
(27 files; +5 this campaign over its 237 baseline, +36 over the original 206), `typecheck`/build
**7/7 / 5/5**, verified end-to-end in the built `truspec serve` binary. Confidence: **high** across the
engine, CLI, code-gen, live servers, scripting, and now the web client + browser security.

**Cycles:** 2 attack + 1 confirmation. Bugs by area/severity:
- Security (CSRF / clickjacking) — **1, med-high**: BUG-M (a malicious site could force-run the user's
  collection via a cross-origin simple POST and/or a hidden `?run=all` iframe).

**Top fix (root cause).**
- **Localhost CSRF** (BUG-M) — the server guarded `Host` (DNS-rebinding) but not `Origin`, and parsed
  POST bodies regardless of content-type (so a no-preflight "simple" request reached the handler).
  Fix: reject cross-origin (non-loopback `Origin`, and `Origin: null`) when bound to loopback, and send
  `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` on every response. `packages/web/server/index.ts`.

**Coverage table (this campaign).**
| Category | Status | Strongest attack survived / found |
|---|---|---|
| UI/UX — XSS | Tested | `<img onerror>`/`<script>`/`<svg onload>`/`</pre><script>` in every render path → React-escaped (proven via renderToStaticMarkup) |
| Security — CSRF | **Fixed** | cross-origin simple POST to all endpoints → now 403; bypass origins (`localhost.evil.com` etc.) blocked |
| Security — clickjacking | **Fixed** | hidden-iframe `?run=all` auto-run → blocked by X-Frame-Options + CSP |
| Regression (all 18 bugs) | Tested | fresh-seed sweep — every guard holds |

**Residual risk & gaps.**
- A **visible top-level navigation** to `…/?run=all` still auto-runs the collection (the silent iframe +
  cross-origin-fetch vectors are now blocked; this one is non-stealthy and is the documented deep-link).
  Consider gating `?run=all` behind a confirm prompt or an explicit opt-in flag. Noted, not changed
  (product decision).
- Defined-SLO load testing still needs a perf harness (carried from Campaign 5).
- BUG-D (empty-run exit 1) and BUG-L (no redirect-follow) remain flagged behavior changes.

**Hardening recommendations.** Keep the XSS + CSRF regression tests in CI; consider a `?run=all` confirm
gate; add the previously-recommended `gen:schema` no-diff check and a scheduled load/soak job.

**Artifacts.** Fix: `packages/web/server/index.ts` (M). Regression/invariant tests:
`packages/web/test/server.test.ts` (+3 CSRF), `packages/web/test/xss.test.ts` (+2, permanent). Attack
harnesses were scratch (removed). This log: `QA_LOG.md`.

---
---

# CAMPAIGN 8 — VS Code extension + dependency CVEs + remaining surfaces — CLEAN

Targeted the last two un-probed areas after seven campaigns: the **VS Code extension** (webview HTML
rendering — a raw-string-HTML XSS surface) and **dependency CVEs** (`pnpm audit`), plus runner URL
schemes, mock request-validation, graceful shutdown, and re-entrancy. Baseline: **242 passed**.

## Cycle 1 — extension webview / deps / runner schemes / shutdown / re-entrancy

### Plan / Findings — NO NEW FAILURES
- **VS Code extension is XSS-safe (doubly).** `extension.ts` creates the webview with
  `enableScripts: false` (JS cannot execute at all), AND `results.ts` `esc()`-escapes every
  user/response-derived string (`esc(r.name)`, `esc(String(msg))`, `esc(o)`, `esc(spec)`); all user
  data is in text content (the only attribute interpolations are numeric — `statusClass`,
  `width:${percent}%`), so `&<>"` escaping is sufficient. Fuzzed `renderResults` with ~3000 random HTML
  payloads → **zero executable-markup leaks**. Strengthened the permanent test to cover assertion
  messages/errors/drift+coverage keys (the untrusted-RESPONSE-data vector): `packages/vscode/test/results.test.ts`.
- **Dependency CVEs: runtime deps are clean.** `pnpm audit` reports 6 vulns (1 low / 3 moderate /
  1 high / 1 critical) — but ALL are in **dev/test tooling** (`vitest`/`vite`/`esbuild` via
  `@vitest/coverage-v8`); they don't ship. The published packages' runtime deps (`yaml`, `zod`,
  `zod-to-json-schema`, `@modelcontextprotocol/sdk`, `react`) are NOT in the vulnerable set → users
  unaffected. (Bumping vitest is a risky major upgrade for a dev-only CVE that needs the vitest-UI/vite
  dev-server to exploit — documented as a maintenance recommendation, not forced per "don't make it worse".)
- **Runner hostile URL schemes** held: `file:///etc/passwd` → "fetch failed", **no file read**;
  `ftp://`/`gopher://`/`javascript:` → clean errors; malformed URLs → "Failed to parse URL"; `data:`
  returns its inline content (benign user-authored mocking). No leak, no crash, no unhandledRejection.
- **Mock `validate:true`** correctly enforces required query/body (400) vs valid (200/201); extra/junk
  params ignored.
- **Graceful shutdown**: `server.close()` with 5 in-flight delayed requests **drained them all** before
  closing — no dropped requests, no uncaught.
- **Re-entrancy**: 20 concurrent `runPath` calls produced identical results (1 distinct outcome) — no
  shared-state contamination.
- **Broad regression** (fresh seeds, ~15k+): all 18 historical bug-class guards hold.

### Cycle outcome — Broke? **no** → confirmation.

## FINAL confirmation — fresh seeds — CLEAN
- F1: vscode escape-fuzz (~3000 payloads) → 0 executable-markup leaks. F2: broad regression (fresh
  seeds) → all guards 0. Broke? **no.** Cycle 1 + confirmation both clean → **STOP met.**

---

# CAMPAIGN 8 — FINAL SUMMARY

**Verdict.** Second **clean campaign**. The VS Code extension — the last untested rendering surface — is
XSS-safe (scripts disabled + full escaping; now fuzz-verified and regression-locked), the shipped
runtime dependencies carry no known CVEs, and runner URL-scheme handling, mock request-validation,
graceful shutdown, and re-entrancy all hold. Final state: `pnpm test` **243 passed** (27 files),
`typecheck`/build **7/7 / 5/5**. Confidence: **high** across every surface this project exposes.

**Cycles:** 1 attack + 1 confirmation. **Bugs found: 0.**

**Coverage table (this campaign).**
| Category | Status | Strongest attack survived |
|---|---|---|
| UI — VS Code webview XSS | Tested | ~3000 random HTML payloads through name/error/message/keys → escaped; webview has enableScripts:false |
| Security — dependency CVEs | Tested | runtime deps clean; the 6 audit findings are dev-only (vitest/vite/esbuild) |
| Security — SSRF / scheme abuse | Tested | file://, ftp://, gopher://, javascript:, data: → no file read, clean errors |
| API/contract — mock request validation | Tested | required query/body enforced (400); junk params ignored |
| Lifecycle — graceful shutdown | Tested | close() drains 5 in-flight delayed requests, none dropped |
| Concurrency — re-entrancy | Tested | 20 concurrent runPath → identical, no contamination |
| Regression (all 18 prior bugs) | Tested | fresh-seed sweep — every guard holds |

**Residual risk & gaps (unchanged).**
- Dev-tooling CVEs (vitest/vite/esbuild) — bump when convenient (major upgrade; dev-only, not shipped).
- `/api/state` O(n)-sync per request (graceful; single-user fine) — Campaign 5 recommendation.
- Defined-SLO throughput load testing needs a perf harness (autocannon/k6).
- A VS Code webview CSP meta tag would be defense-in-depth (not required — scripts already disabled).
- Behavior changes still flagged for review: BUG-D (empty-run exit 1), BUG-L (no redirect-follow),
  the `?run=all` visible-navigation residual.

**Hardening recommendations.** Keep the extension escaping + web XSS/CSRF tests in CI; schedule a
`pnpm audit` + dev-dep bump job; add the previously-recommended `gen:schema` no-diff check and a
load/soak job; consider a webview CSP and a `?run=all` confirm gate.

**Artifacts.** No source changes this campaign (zero bugs). Strengthened test:
`packages/vscode/test/results.test.ts` (+1). Attack harnesses were scratch (removed). This log: `QA_LOG.md`.

---

## Cycle 2 (Campaign 8, reopened) — LIVE BROWSER testing (Windows Chrome via WSL)

User pointed out a real Windows browser was available. The Linux cached chromium couldn't run
(`libnspr4.so` missing, no passwordless sudo to `apt install` deps), so I drove **Windows Chrome**
(`/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`, headless) against WSL-hosted servers
(reachable via `localhost` forwarding, Host=localhost). To avoid the fragile WSL↔Windows CDP bridge, I
used a **beacon design**: XSS payloads `new Image().src` to a WSL collector if they execute; the CSRF
attacker page (on a DIFFERENT loopback port) `POST`s `/api/request` and a written file is server-side proof.

### Findings

- [BUG-N] security/CSRF — Origin guard allows cross-PORT loopback origins | severity **medium**
  - Repro (live, Windows Chrome): attacker page on `http://localhost:4392` issues a cross-origin
    `POST http://localhost:4391/api/request` (text/plain, no preflight). Browser fetch fails CORS
    (`Failed to fetch`) but the server **executed it and WROTE `csrf-proof.tspec.yaml`** into the
    workspace. Evidence: `CSRF_FILE_WRITTEN_SERVER_SIDE=true`.
  - Root cause: BUG-M's `originAllowed` only checked that the Origin's *hostname* was loopback — but
    `localhost:OTHER_PORT` is loopback too. So a page on any OTHER local port (a second dev server, a
    malicious local service) bypassed the guard. The C7 curl test only covered the remote vector
    (`Origin: evil.com → 403`); the live browser exposed the cross-port one.
  - Fix: `packages/web/server/index.ts` — `originAllowed` now requires `new URL(origin).host` (host:port)
    to equal the request's **Host** header (standard Origin-vs-Host CSRF check). Same-origin UI requests
    match; cross-site AND cross-port pages don't. Re-verified live: `CSRF_FILE_WRITTEN_SERVER_SIDE=false`.
  - Regression test: `packages/web/test/server.test.ts` → "refuses cross-origin POSTs — cross-site AND
    cross-PORT loopback" (evil.com, null, `localhost:port+1`, `127.0.0.1:9999` → all 403) +
    "allows same-origin (matching Host) and origin-less".
  - Suite after fix: **PASS — 243 tests, typecheck 7/7, 0 regressions.**

### Attacks that held (live browser, Windows Chrome)
- **XSS confirmed safe IN A REAL BROWSER**: request name/url/docs as `<img onerror=beacon>` rendered by
  the React UI (incl. `?run=all` results) → `XSS_FIRED=false` (zero beacons; React escaped everything).
  This upgrades C7's `renderToStaticMarkup` proof to a live-browser confirmation.
- **Clickjacking blocked**: the attacker's `<iframe src=".../?run=all">` does not render the UI
  (`X-Frame-Options: DENY`); Chrome fires `onload` for the blocked placeholder but the app never runs.

### Cycle outcome
- Broke? **yes** (BUG-N medium — found by the live browser, missed by curl) → fixed at root + tests +
  live re-verification → green (243). The live-browser route closed a real gap. **Campaign 8's earlier
  "0 bugs" summary is superseded: it found 1 bug (BUG-N) once a real browser was used.**

---

# CAMPAIGN 8 — CORRECTED FINAL SUMMARY (live-browser supersedes the earlier "clean")

**Verdict.** Campaign 8's static/code-analysis pass was clean, but once a **real browser** (Windows
Chrome via WSL) was actually driven against the running web UI, it found **BUG-N** — a cross-PORT
loopback CSRF that the C7 curl test (remote-origin only) had missed. Fixed at root (Origin must match the
Host the server was reached on) and re-verified live. The VS Code extension remains XSS-safe and runtime
deps remain CVE-free. Final state: `pnpm test` **243 passed** (27 files), `typecheck`/build **7/7 / 5/5**.

**Cycles:** 1 static attack (clean) + 1 LIVE-BROWSER attack (found BUG-N) + confirmation. **Bugs: 1 (BUG-N, security/CSRF, medium).**

**Top fix.** `originAllowed` upgraded from "Origin hostname is loopback" → "Origin host:port equals the
request Host" — the standard Origin-vs-Host CSRF check. Blocks cross-site AND cross-port pages; allows
the genuine same-origin UI and origin-less non-browser clients. `packages/web/server/index.ts`.

**Live-browser coverage (newly closed).**
| Category | Status | Evidence |
|---|---|---|
| UI XSS (real browser) | Tested | Windows Chrome rendered malicious collection data via beacons → `XSS_FIRED=false` |
| CSRF cross-port (real browser) | **Fixed** | attacker page on `localhost:4392` wrote a file on `:4391` (pre-fix) → blocked (post-fix) |
| Clickjacking (real browser) | Tested | `<iframe ?run=all>` does not render the UI (`X-Frame-Options: DENY`) |

**Process lesson (honest).** For 7 campaigns I tested the web UI/CSRF via `renderToStaticMarkup` + curl
and called it "tested" — a real browser was the missing tool, and it immediately produced a security
bug. The Linux cached chromium lacked system libs (no passwordless sudo); the fix was to drive Windows
Chrome over WSL `localhost` forwarding with a beacon-based harness (no CDP needed).

**Residual risk & gaps (updated).**
- When `serve` is bound to a non-loopback host (explicit `--host`, user opted into exposure), the Origin
  guard steps aside by design — document that exposing the UI on a LAN disables CSRF protection.
- Dev-tooling CVEs (vitest/vite/esbuild) — dev-only, not shipped; bump when convenient.
- Behavior changes still flagged: BUG-D (empty-run exit 1), BUG-L (no redirect-follow), `?run=all`
  visible-navigation residual.
- A reusable Playwright harness in CI (against Windows/Linux Chrome) would keep the live UI surface covered.

**Artifacts.** Fix: `packages/web/server/index.ts` (N). Regression: `packages/web/test/server.test.ts`
(cross-port CSRF). Live harness: `/tmp/qa/live2.mjs` (beacon-based, Windows Chrome). This log: `QA_LOG.md`.

---
---

# CAMPAIGN 9 — live UI interaction testing (full browser control)

Got real browser CONTROL working (the missing piece for interaction testing): the Linux cached chromium
needed 5 shared libs (`libnspr4/libnss3/libnssutil3/libsmime3/libasound`); with no passwordless sudo I
`apt-get download`ed libnspr4/libnss3/libasound2t64 (no sudo needed), `dpkg -x`'d them locally, and ran
chromium via Playwright with `LD_LIBRARY_PATH`. Drove the real React UI (editor save, keyboard, deep-links,
double-click). Baseline: **243 passed**.

## Cycle 1 — editor save flow / keyboard / deep-links / re-entrancy

### Findings

- [BUG-O] UI/accessibility — editor keyboard shortcuts only work when the textarea is focused | severity **low**
  - Repro (Playwright, `/tmp/qa/esc.mjs`): open the new-request editor, press **Esc**:
    from the **textarea** → cancels; from the **path input** → does NOT; from the just-opened state
    (focus still on the "+ new" button) → does NOT. The editor hint advertises "Esc to cancel ·
    ⌘/Ctrl+Enter to save" unconditionally, but a keyboard-only user (who starts in the path input in
    "new" mode, or hasn't clicked a field yet) gets nothing.
  - Root cause: the `onKeyDown` handler was attached only to the `<textarea>`, so the shortcuts were
    scoped to textarea focus (and didn't fire from the path input, the buttons, or before a field was
    focused). `packages/web/src/App.tsx`.
  - Fix: a **document-level** `keydown` listener registered via `useEffect` while the Editor is mounted
    (refs hold the latest `save`/`onCancel` so it never re-binds on keystrokes). Esc/Ctrl+Enter now work
    from anywhere the moment the editor opens. Verified live: Esc cancels from textarea / path input /
    body-focus (all three), and the full 14-check UI suite passes.
  - Regression test: covered by the Playwright UI harness (fails before — "Esc from path input → not
    closed"; passes after). **No vitest regression added**: the project has no DOM/browser test
    environment, and adding Playwright/jsdom as deps for a low-sev a11y fix is a maintainer decision —
    recommended as a CI hardening item instead (honest infra gap, not faked).
  - Suite after fix: **PASS — 243 tests, typecheck 7/7, build 5/5, 0 regressions.**

### Attacks that held (live UI, real chromium)
- **Editor save flow**: a valid new request writes the file and appears in the sidebar; **Ctrl+Enter**
  saves; a **double-click** on save yields one valid, uncorrupted file (re-entrancy safe).
- **Hostile path** (`../../../../tmp/...`): the UI shows "Path escapes the workspace" and **no file is
  written outside** the workspace (confinePath + the live UI agree). Invalid-schema content → error
  shown, no file written.
- **Deep-links**: `?new=1` opens the editor; `?theme=light` applies the light theme.
- **No uncaught page errors** across all interactions.

### Cycle outcome
- Broke? **yes** (BUG-O low) → fixed at root + live re-verification → green (243). Restart Cycle 2.

## Cycle 2 — extended UI interactions + XSS/CSRF re-confirm — CLEAN
- run-all (2 results), theme toggle (dark→light), **edit existing request persists to disk**, spec
  analyze renders drift/coverage, no uncaught page errors. XSS_FIRED=false, CSRF_FILE_WRITTEN=false
  after the client rebuild. **No new failures** → confirmation.

## FINAL confirmation — CLEAN
- UI suite 14/14, extended 5/5, full vitest **243**. Broke? **no.** Two clean passes → **STOP met.**

---

# CAMPAIGN 9 — FINAL SUMMARY

**Verdict.** Achieved real browser CONTROL (cached Linux chromium + locally-extracted libs, no sudo) and
drove the actual React UI — the genuinely-untested interaction layer. Found **BUG-O** (editor keyboard
shortcuts scoped to the textarea, breaking Esc/Ctrl+Enter for keyboard-only users) and fixed it; every
other interaction held. Final state: `pnpm test` **243 passed**, typecheck/build **7/7 / 5/5**, and the
live UI passes a 14-check + 5-check interaction suite. Confidence: **high** for the web UI now that it's
been driven, not just code-reviewed.

**Cycles:** 1 attack + 1 confirmation. **Bugs: 1 (BUG-O, UI/a11y, low).**

**Top fix.** Editor keyboard handler moved from the `<textarea>` `onKeyDown` to a **document-level
`keydown` listener** (useEffect + refs) so "Esc to cancel / ⌘Ctrl+Enter to save" work from the path
input, the buttons, and the just-opened state. `packages/web/src/App.tsx`.

**Live UI coverage (newly closed).**
| Interaction | Result |
|---|---|
| Editor save (valid/new) → file + sidebar | held |
| Hostile path save → error, no file outside workspace | held |
| Invalid-schema save → error, no file | held |
| Ctrl+Enter save / **Esc cancel from any focus** | **fixed (BUG-O)** |
| Double-click save (re-entrancy) → one valid file | held |
| Edit existing → change method → persists | held |
| Run / Run-all → results render | held |
| Theme toggle + deep-links (?new, ?theme) | held |
| Spec analyze → drift/coverage render | held |
| Uncaught page errors | none |

**Residual risk & gaps.**
- **No automated UI regression in the suite**: the project has no DOM/browser test env; a Playwright e2e
  job is the right home for the BUG-O regression (and the XSS/CSRF live checks). I verified BUG-O
  fail-before/pass-after with a Playwright harness but did not add Playwright/jsdom as project deps for a
  low-sev fix (maintainer decision). **Recommended CI item.**
- Browser-control setup here was bespoke (cached chromium + manually-extracted libs because no sudo /
  NAT-mode WSL blocked CDP-to-Windows-Chrome); CI should use `npx playwright install --with-deps`.
- Behavior changes still flagged: BUG-D, BUG-L, the `?run=all` residual.

**Hardening recommendations.** Add a Playwright e2e CI job (editor save/keyboard, XSS render, cross-origin
CSRF) using `playwright install --with-deps`; this permanently covers the UI surface and the BUG-N/BUG-O
regressions.

**Artifacts.** Fix: `packages/web/src/App.tsx` (O). Live harnesses (scratch, `/tmp/qa/`): `ui.mjs`
(14 checks), `ui2.mjs` (5 checks), `esc.mjs` (keyboard-focus matrix), `live2.mjs` (XSS/CSRF beacons),
`pwsmoke.mjs`. This log: `QA_LOG.md`.

---
---

# CAMPAIGN 10 — accessibility audit (axe-core, live browser)

Ran the standard a11y engine (**axe-core 4.12.1**) against the live React UI (main view, editor, spec
view) via Playwright + the cached chromium. Baseline: **243 passed**.

## Cycle 1 — accessibility

### Findings

- [BUG-P] UI/accessibility — unlabeled form controls + missing heading/landmark semantics | severity **medium**
  - Repro (axe-core, `/tmp/qa/a11y.mjs`):
    - **critical `select-name`**: the spec dropdown `<select>` (`.spec-pick`) has NO accessible name —
      a screen reader announces an unlabeled combobox; the user can't tell what it selects.
    - **critical `label`**: the editor `<textarea>` (request YAML) and the path `<input>` have no label.
    - **moderate `page-has-heading-one`**: no `<h1>` on the page (the visible "TruSpec" brand is a `<div>`).
    - **moderate `region`**: the results `<section>` isn't a named landmark, so its content sits outside
      landmark regions.
  - Root cause: form controls relied on adjacent visual text (not programmatically associated); the brand
    and results section used non-semantic markup. `packages/web/src/App.tsx`, `packages/web/src/styles.css`.
  - Fix: `aria-label` on the spec select ("OpenAPI spec"), the editor textarea ("request YAML"), and the
    path input ("file path"); a visually-hidden `<h1 className="sr-only">` (with a new `.sr-only` utility
    in `styles.css`); `aria-label="run results"` on the results `<section>` to make it a landmark. The
    env select already had an accessible name (wrapped in `<label>`), confirmed by axe. Re-audit:
    **all critical + moderate violations cleared** (select-name, label, heading-one, region → gone).
    Zero visual change (aria + sr-only only). Full suite/typecheck/build still green.
  - Regression test: covered by the axe-core harness (fails before — select-name/label/heading/region;
    passes after). No vitest regression added (no DOM/browser test env — same infra gap as BUG-O);
    recommended as an axe-core + Playwright CI job.
  - Suite after fix: **PASS — 243 tests, typecheck 7/7, build 5/5, 0 regressions.**

### Non-bug finding (documented — design decision, not forced)
- **`color-contrast` (serious, 3–4 nodes)**: muted/decorative text (`.tag`, `.brandlet`, `.muted`,
  `.editor-hint`) uses `--dimmer: #565c66` / `--dim: #888e98`, which fall below WCAG AA 4.5:1 on the dark
  background. A real low-vision issue, but the fix is a color-palette change (the "muted" dimness is
  intentional design). Recommendation: raise `--dimmer` (e.g. → ~#7a8088) and verify `--dim` hits ≥4.5:1
  in both themes. Left to the maintainer's design judgment rather than guessing replacement colors.

### Cycle outcome
- Broke? **yes** (BUG-P medium — unlabeled controls block screen-reader users) → fixed at root + axe
  re-verification → green (243). Restart Cycle 2.

## Cycle 2 — confirmation (a11y + interactions + XSS) — CLEAN
- axe re-audit: only `color-contrast` remains (labeling/heading/region all fixed). XSS still escaped
  (malicious request name doesn't execute, no `img[onerror]` in DOM). BUG-O Esc-from-path-input still
  works. Save flow (Ctrl+Enter) still writes. Spec select now named "OpenAPI spec". No page errors.
- Final stability re-run: 7/7. Full vitest **243**. Broke? **no** → STOP.

---

# CAMPAIGN 10 — FINAL SUMMARY

**Verdict.** Ran a real accessibility audit (axe-core) against the live UI — the last unexercised slice
of the UI/a11y category. Found **BUG-P** (screen-reader-blocking unlabeled controls + missing
heading/landmark semantics) and fixed it with zero visual change; verified via re-audit. One residual
(`color-contrast`) documented as a design decision. Final state: `pnpm test` **243 passed**,
typecheck/build **7/7 / 5/5**, live UI passes a11y + interaction + XSS confirmation.

**Cycles:** 1 attack + 1 confirmation. **Bugs: 1 (BUG-P, UI/a11y, medium).**

**Top fix.** `aria-label` on the spec select / editor textarea / path input; a visually-hidden `<h1>`
(`.sr-only`); `aria-label` landmark on the results section. `packages/web/src/App.tsx`, `styles.css`.

**Coverage table (this campaign).**
| Category | Status | Result |
|---|---|---|
| a11y — screen-reader (control names) | **Fixed** | spec select + editor textarea/path input were unlabeled (axe critical) → labeled |
| a11y — heading / landmark structure | **Fixed** | added an h1 + named the results landmark (axe moderate) |
| a11y — color contrast | Documented | muted text < WCAG AA 4.5:1; design-palette change, recommended not forced |
| a11y — keyboard reachability | Tested | 8 focusable controls; all interactive elements keyboard-operable (BUG-O fixed in C9) |

**Residual risk & gaps.**
- **Color contrast** on muted/decorative text (`--dimmer`/`--dim`) — raise to ≥4.5:1 (design decision).
- **No automated UI/a11y regression in the suite** (no DOM/browser env) — BUG-O and BUG-P regressions
  live in the Playwright + axe-core harnesses; **recommend an e2e CI job** (`playwright install
  --with-deps` + axe-core) to cover BUG-N/O/P permanently. Honest infra gap, not faked.
- Behavior changes still flagged: BUG-D, BUG-L, the `?run=all` residual.

**Hardening recommendations.** Add a Playwright+axe-core e2e CI job (editor save/keyboard, XSS render,
cross-origin CSRF, a11y violations=0 except documented contrast). Address color-contrast in a design pass.

**Artifacts.** Fixes: `packages/web/src/App.tsx`, `packages/web/src/styles.css` (P). Harnesses (scratch,
`/tmp/qa/`): `a11y.mjs` (axe audit), `conf.mjs` (confirmation). This log: `QA_LOG.md`.
