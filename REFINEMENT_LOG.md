# TruSpec refinement log

A running record of a 100-iteration refinement campaign: competitive research, feature work,
UI/UX polish, and stabilization. Each iteration is a self-contained, tested, committed change.

## Competitive baseline (research, Sept 2026)

| Capability | Postman | Bruno | Insomnia | Hoppscotch | TruSpec (before) |
|---|:--:|:--:|:--:|:--:|:--:|
| Plain-text collections in git | ✗ | ✓ | partial | ✗ | ✓ |
| Fully offline, no account | ✗ | ✓ | ✗ | ✗ | ✓ |
| OpenAPI drift gate in CI | ✗ | basic | ✗ | ✗ | ✓ |
| OpenAPI coverage report | ✗ | ✗ | ✗ | ✗ | ✓ |
| Response contract validation | partial | ✗ | ✗ | ✗ | ✓ |
| Local mock server | cloud | ✗ | ✗ | ✗ | ✓ |
| First-party MCP server | bolted-on | community | ✗ | ✗ | ✓ |
| **Code generation (many langs)** | ✓ 30+ | ✓ 35+ | ✓ | ✓ | **✗ (curl only, UI-only)** |
| **curl / HAR / Insomnia / OpenAPI import** | ✓ | ✓ | ✓ | ✓ | **✗ (postman + bruno only)** |
| **OAuth2 / digest / AWS SigV4 auth** | ✓ | ✓ | ✓ | partial | **✗** |
| **Cookie jar** | ✓ | ✓ | ✓ | ✓ | **✗** |
| **Multipart / file upload** | ✓ | ✓ | ✓ | ✓ | **✗** |
| **Data-driven runs (CSV/JSON)** | ✓ | ✓ | ✗ | ✗ | **✗** |
| JUnit CI report | ✓ (newman) | ✓ | ✗ | ✗ | ✓ (`--reporter junit`) |
| **HTML CI report** | ✓ (newman) | ✓ | ✗ | ✗ | **✗** |
| **Run selection (`--grep` / tags / `--bail`)** | ✓ | ✓ | ✗ | ✗ | **✗** |
| **Proxy / TLS / client certs** | ✓ | ✓ | ✓ | ✗ | **✗** |
| **Retries / redirect policy** | ✓ | ✓ | ✓ | ✓ | **✗** |
| **SSE / streaming** | ✓ | ✓ | ✓ | ✓ | **✗** → ✓ (iteration 77) |

Gaps above drive the roadmap below. TruSpec's differentiators (spec-sync, offline, agent-native)
stay first-class; parity work must not compromise them.

## Roadmap themes

- **A. Engine + format parity** — codegen, importers, auth methods, bodies, transport options.
- **B. CLI / CI ergonomics** — reporters, selection, data-driven runs, scaffolding, lint.
- **C. Web + desktop UI/UX** — response viewing, discoverability, keyboard, a11y, resilience.
- **D. Stability + quality** — tests, fuzzing, perf, docs, release hygiene.

## Iterations

### 1 — Code generation for 17 clients and languages

**Gap.** Bruno and Postman both generate snippets in 30+ languages; TruSpec had a curl-only
builder that lived in the web client, duplicated the runner's resolution rules, and was reachable
from nowhere else.

**Change.** New `@truspec/core/codegen` module: a normalized `HttpShape` (structured body kept
structured, so each language emits its idiomatic form) plus 17 renderers — curl, HTTPie, wget,
PowerShell, JS fetch/axios, Python requests/httpx, Go, Ruby, PHP, Java, Kotlin, C#, Rust, Swift,
Dart. Snippets resolve through the *real* engine (`resolveRequest`), so folder `baseUrl`,
inherited headers and auth apply exactly as at run time. Added an `onMissing: "keep"` policy to
`interpolate`, so an unresolved `{{var}}` survives into a snippet as its authored placeholder
instead of being blanked. New `prepareRequest()` in `workspace` gives non-run consumers the same
folder + environment context the runner builds.

Surfaced everywhere: `truspec codegen` CLI (`--lang`, `--env`, `--output`, `--list`),
`POST /api/codegen` + a language-picker modal in the web UI (replacing the curl button and the
duplicated client-side builder), and the `truspec_codegen` / `truspec_codegen_targets` MCP tools.

**Verification.** 384 tests (was 352) — 17 core codegen, 9 CLI, 3 web API, 3 MCP. Typecheck 8/8,
build 5/5. e2e `code-snippets.spec.ts` replaces `copy-as-curl.spec.ts` and also covers switching
language.

### 2 — Import a `curl` command

**Gap.** "Copy as cURL" from devtools is the most common way a real request enters an API client.
Postman, Insomnia and Bruno all accept a pasted command; TruSpec accepted only Postman JSON and
Bruno directories, so the fastest on-ramp was missing entirely.

**Change.** New `importCurl()` in `@truspec/core/importers`, built on a real POSIX-subset shell
tokenizer (single/double quotes, `$'…'` ANSI-C quoting, backslash escapes, `\`-continuations, and
quote-awareness so `curl` inside a header value can't split the command). Handles `-X`, `-H`,
`-d`/`--data-raw`/`--data-binary`/`--data-urlencode`/`--json`, `-G`, `-I`, `-F`, `-u`, `-A`, `-e`,
`-b`, `--url`, combined short flags (`-XPOST`, `-H'A: b'`), and skips known no-op flags without
swallowing the URL. Bearer/basic `Authorization` (and `-u`) are lifted into structured `auth`;
JSON/urlencoded bodies become typed bodies; several commands in one paste become several files.
Flags with no request-file equivalent (`-F` multipart, `-k`, `--proxy`) warn instead of vanishing.

Surfaced as `truspec import curl <command|file|->`, `POST /api/import/curl` behind a
"paste a curl command" pane in the web import dialog, and the `truspec_import_curl` MCP tool.

**Verification.** 414 tests (was 384) — 22 core (tokenizer + importer), 4 CLI, 2 web API, 2 MCP.
Typecheck 8/8, build 5/5.

### 3 — Run selection and control (`--grep`, `--tag`, `--bail`, `--delay`, `--var`)

**Gap.** `truspec run` was all-or-nothing: no way to run just the smoke subset, stop at the first
failure, pace against a rate limit, or override a variable from CI. Postman's newman and Bruno's
runner have all four; a CI gate without them forces either a full run on every push or an ad-hoc
directory layout.

**Change.** `runPath` gained `grep`, `tags`, `bail`, `delayMs` (with an injectable `sleep`), and
the format gained an optional `tags: string[]` on a request. `grep` matches the request's **name
or its workspace-relative path** — both are things people reach for — and an invalid pattern
fails loudly rather than matching nothing. Tags OR together; grep and tags AND together.

`WorkspaceRunResult` now reports `skipped` (selected but never sent, because `bail` stopped the
run) and `deselected` (filtered out before it started), and the human reporter prints both — a
run that shrank should say why. A filter matching nothing exits 1 with a filter-specific message,
because a filtered run that passes by running zero requests is exactly the false positive the gate
exists to prevent.

CLI: `--grep/-g`, `--tag` (repeatable), `--bail`, `--delay`, and `--var name=value` (repeatable,
wins over the environment — for a per-branch base URL in CI).

**Verification.** 432 tests (was 414) — 14 core selection/control, 4 CLI. Schema regenerated.
Typecheck 8/8, build 5/5.

### 4 — Standalone HTML run report

**Gap.** `--reporter junit` is machine-readable but unreadable; a CI failure meant scrolling raw
log text. newman and Bruno both ship an HTML report artifact.

**Change.** `--reporter html` writes one self-contained page — no external CSS, fonts or scripts,
so it opens from `file://`, an artifact viewer, or under a strict CSP (`<details>` does the
expanding instead of JS). Verdict, counts and total time up top; then a card per request with
failed assertions listed first, captured values, and a collapsible response. Bodies truncate past
200 KB so the artifact stays openable. Every interpolated value is HTML-escaped — bodies, headers
and assertion messages are attacker-controlled.

Also fixed: an unknown `--reporter` silently produced human output; it now exits 2 and names the
valid reporters.

**Verification.** 442 tests (was 432) — 8 report unit tests (including an XSS payload through
name/URL/error/headers/body, and the truncation path) and 2 CLI. Typecheck 8/8, build 5/5.

### 5 — OAuth2 authentication

**Gap.** `auth` supported only `none`/`bearer`/`basic`/`apikey`. Every competitor supports OAuth2,
and it is the single most common scheme on real APIs — without it, a TruSpec collection against an
OAuth-protected API needed an out-of-band script to mint a token and inject it as a variable.

**Change.** New `auth: { type: oauth2 }` with the three grants a machine can complete unattended:
`client_credentials` (default), `password`, and `refresh_token`. An interactive authorization-code
flow needs a browser a CI gate doesn't have, so it is deliberately excluded and documented as such
(capture the refresh token once, then use `refresh_token`).

The token is fetched before the request in `runRequest` (the resolver stays synchronous — it
receives the acquired credential as an override) and cached per run, keyed by grant + endpoint +
client + scope + audience, with a 30s expiry skew so a token can't expire mid-flight. A
folder-level block shared by twenty requests therefore hits the token endpoint **once**: a real
rate-limit hazard and a real cost on metered providers.

Failures never throw: the provider's own error body (`invalid_client`, …) becomes the request's
error and the API is never called. `clientAuth: body|basic` covers providers that accept only one
form; `audience` and `extra` cover Auth0/Okta-style parameters. `codegen` renders an oauth2
request with an honest `{{accessToken}}` placeholder rather than inventing a credential.

Surfaced in the web UI's auth editor with a grant-aware form.

**Verification.** 461 tests (was 442) — 19 covering the grants, client-auth placement,
interpolation, every failure mode, cache hit/expiry/keying, and end-to-end through `runRequest`
including folder inheritance and request-level override. Schema regenerated. Typecheck 8/8,
build 5/5.

### 6 — Per-request transport options (timeout, retries, redirects)

**Gap.** Timeout was run-wide only; there were no retries at all (a flaky staging API meant a red
CI build for a reason unrelated to the code), and redirects could never be followed.

**Change.** New optional `options` block on a request: `timeoutMs`, `retries`, `retryDelayMs`,
`followRedirects`, `maxRedirects`. Every default reproduces the previous behavior exactly, so the
block is purely additive.

Retries cover transport errors, `429`, and `5xx` — never a `4xx` or a failed assertion, which are
answers rather than faults — with exponential backoff capped at 5s and an injectable sleep so
tests don't wait.

Redirect following is **opt-in and hand-rolled** rather than delegated to `fetch`, for two
reasons. First, each hop is reported on the result. Second, and more importantly, the platform's
own follow carries `Authorization` to whatever host the `Location` names; TruSpec drops
`Authorization` and `Cookie` the moment the origin changes. Method rewriting matches real clients:
`303` (and `301`/`302` on a non-GET) becomes a bodiless `GET` with the body's content headers
removed; `307`/`308` preserve both.

**Verification.** 477 tests (was 461) — 16 covering retry eligibility, backoff shape, the
exhausted-budget path, redirect hop reporting, the `maxRedirects` stop, per-status method
rewriting, same- vs cross-origin credential handling, an unusable `Location`, and end-to-end
reporting through `runRequest`. Schema regenerated. Typecheck 8/8, build 5/5.

### 7 — Richer assertions, and failure messages a CI log can act on

**Gap (two of them).** `jsonpath` could only do `exists`/`equals`/`matches`, so "this array has at
least one item", "this total is a non-negative number", "this status is one of these three" all
needed a JS script — the exact thing the declarative format exists to avoid. And every failure
message was shape-only: `jsonpath $.total matched 1 value(s)` never said *what the value was* or
*which condition failed*.

**Change.** `jsonpath` gains `notEquals`, `oneOf`, `contains` (substring for strings, membership
for arrays), `gt`/`gte`/`lt`/`lte` (a non-number fails rather than being coerced), `valueType`
(with `array` and `null` distinguished from `object`), `length`/`minLength`/`maxLength`, and
`empty`. `header` gains `notEquals` and `contains`; `body` gains `equals`, `notContains` and
`empty`. Conditions AND together, and unknown keys are still rejected, so a typo is still an error.

Messages were rebuilt around a `Check { ok, desc }` pair, so a result names the actual value and
lists only the conditions that failed:

```
✗ jsonpath $.total → "12.50" fails is a number & >= 0
✗ header "X-Request-Id" (absent) fails exists
```

Long values truncate rather than dumping a whole body into the log.

The web assertion editor exposes all of it with grouped dropdowns, typed inputs per condition, and
JSON coercion on value fields — previously the UI could only ever emit a *string*, so
`equals: 200` was impossible without dropping to the YAML editor.

**Verification.** 497 tests (was 477) — 20 covering each new condition, the non-coercion rules,
message wording, truncation, and that schema strictness still catches typos. Schema regenerated.
Typecheck 8/8, build 5/5.

### 8 — `truspec lint`: static checks over a collection

**Gap.** Nothing checked a collection *before* it ran. A committed API key, a JSONPath typo that
silently never matches, a request with no assertions (which can never fail a run), a `{{var}}` no
environment declares — all of these were invisible until someone noticed, or never.

**Change.** New `@truspec/core/lint` with eight rules, each carrying a stable id so a finding can
be suppressed, looked up, or acted on by an agent rather than paraphrased:

- **errors:** `parse`, `inline-secret` (JWT / `ghp_…` / `sk_live_…` / AWS key id / Slack / Google /
  PEM — deliberately narrow, because a linter that cries wolf gets muted), `bad-jsonpath`.
- **warnings:** `no-assertions`, `duplicate-name`, `undeclared-var`, `absolute-url`,
  `insecure-url`.

`undeclared-var` models the run's real semantics: a captured variable counts as declared for every
request that runs *after* it, names a pre-request script sets with `tr.set` count for that request,
and `{{…}}` inside `docs` or a script body is not an interpolation site. Environments are found the
way the runner finds them — from the workspace root above the target *and* any nested collection
below it — so linting a directory containing several collections doesn't report every variable as
missing (caught by running it against this repo's own `examples/`).

Surfaced as `truspec lint [dir] [--strict] [--json] [--disable] [--list-rules]` and the
`truspec_lint` MCP tool.

**Verification.** 521 tests (was 497) — 17 core (each rule, plus the ordering and
non-interpolation-site subtleties) and 7 CLI (exit codes, `--strict`, `--json`, `--disable`).
`truspec lint examples` is clean. Typecheck 8/8, build 5/5.

### 9 — `truspec init`, and a first run that actually passes

**Gap.** There was no way to start a project except by hand-writing a folder config, an
environment and a first request from the docs.

**Change.** `truspec init [dir]` scaffolds a folder config, a request, an environment, a
`.env.example`, and a `.gitignore` rule for `.env` (so the first secret anyone adds isn't
committed). Files are serialized *through the schema*, so a scaffold can never emit something the
parser rejects. Re-running is safe — existing files are reported and left alone, never clobbered.

Building it surfaced two real bugs in the pre-existing `gen` path, both of which made a scaffolded
collection fail on its very first run:

1. **Path parameters were never declared.** `gen` emits `{{id}}` from `/posts/{id}` but nothing
   declared it, so the first run died with `Unresolved variables: {{id}}`. `scaffoldFromSpec` now
   reports `pathVariables` with a sample derived from the spec (parameter `example` → schema
   `example`/`default`/first `enum` → type- and format-appropriate placeholder, so a `uuid`
   parameter gets a real UUID). `init --spec` seeds them into the environment; `gen` prints them.
2. **Every scaffolded request asserted `status: 200`,** even for an operation the spec documents
   as `201`. `SpecOperation` now carries `successStatus` (lowest documented 2xx) and the scaffold
   asserts that.

With both fixed, `init --spec` → `mock` → `run` is green offline out of the box (verified
end-to-end against `examples/blog`, 4/4 passing).

**Verification.** 540 tests (was 521) — 13 core (idempotence, `.gitignore` append-not-duplicate,
force, spec scaffolding, sample derivation per source, next-step wording) and 6 CLI. The scaffold
is also asserted to be **lint-clean**. Typecheck 8/8, build 5/5.

### 10 — `multipart/form-data` with file uploads

**Gap.** File upload is table stakes in every competitor and TruSpec had no body type for it. The
curl importer had to downgrade `-F` to a urlencoded form and warn about it.

**Change.** New `body: { type: multipart, fields }`, where a field is a plain value, a typed text
part, or `{ file, filename?, contentType? }`.

The layering matters: `resolveRequest` (synchronous, browser-safe) resolves the *parts* but does
not read anything; the runner assembles the `FormData` through an **injected file reader**, which
the workspace runner supplies. That reader resolves paths relative to the request file (what an
author expects) and confines them to the workspace, so a collection — which may have been
imported, generated, or written by an agent — cannot read `../../.ssh/id_rsa` and POST it. A
runner without filesystem access fails with a clear message rather than silently sending nothing.
`Content-Type` is deliberately never set, since the boundary is generated at assembly time.

Knock-on work, both of which would otherwise be silent correctness bugs:

- **codegen** renders true multipart for curl (`-F`), HTTPie (`--form`, `field@path`), fetch/axios
  (`FormData`) and Python (`files=` + `data=`). Every other target prints a comment describing the
  parts instead — falling back to a urlencoded body would produce a snippet that looks right, runs,
  and hits the server with the wrong content type.
- **curl import** now produces a real multipart body, including `@path` file parts and `;type=` /
  `;filename=` modifiers, replacing the lossy fallback.

Also added to the web UI's body editor, with an explicit text/file choice per part.

**Verification.** 555 tests (was 540) — 11 multipart (resolution, no Content-Type, blob typing,
missing-reader path, and a **workspace-escape test proving a `../../` path is refused and nothing
is sent**), plus codegen and importer coverage. Typecheck 8/8, build 5/5.

### 11 — Cookie jar

**Gap.** A login request that sets a session cookie is the most common multi-request flow there
is, and TruSpec had no way to express it except capturing the header by hand. Every competitor
carries cookies automatically.

**Change.** An RFC 6265-shaped in-memory `CookieJar`: domain matching with a dot boundary (so
`evilapi.test` cannot claim a cookie set for `api.test`), a `Domain` attribute the setting host
must actually belong to, path matching on segment boundaries, `Secure` withheld from plaintext,
`Max-Age` winning over `Expires`, past expiry treated as deletion, and most-specific-path-first
ordering.

Two details that matter more than they look:

- **Repeated `Set-Cookie` headers are read with `getSetCookie()`**, not `headers.get()`, which
  comma-joins them and corrupts any cookie whose `Expires` date contains a comma.
- **Cookies are stored and re-sent per redirect hop**, not just on the final response — a login
  that 302s sets its session cookie on the redirect, not on the page you land on. The transport
  gained `cookieHeaderFor`/`onResponse` hooks for exactly this, which also means a cookie for one
  host can never survive into a hop to another.

One jar per run, never persisted. A request's own `Cookie` header wins. `--no-cookies` opts out.

**Verification.** 573 tests (was 555) — 18 covering the matching rules, the two look-alike-host
attacks, expiry semantics, the comma-join hazard, the redirect-hop case, explicit-header
precedence, and the workspace default plus opt-out. Typecheck 8/8, build 5/5.

### 12 — Data-driven runs (`--data`, `--repeat`)

**Gap.** No way to run a collection over a dataset — the `newman -d` / Bruno-runner capability
that turns one request into a table-driven test.

**Change.** `--data <file.csv|json>` runs the whole selection once per row, with the row's columns
as variables; `--repeat <n>` repeats without a dataset. The CSV parser is a real RFC 4180 one
(quoted fields, embedded commas and newlines, `""` escapes, CRLF normalization) — `split(",")`
corrupts every realistic dataset, which is exactly the data request payloads contain.

Two decisions worth naming:

- **Iterations are independent.** Each starts from the same base variables with a *fresh cookie
  jar*, so row 2 cannot inherit row 1's captured ids or session. The OAuth2 token cache is
  deliberately shared, since the credentials don't change between rows.
- **An empty or missing dataset is an error, not a pass.** A gate that never exercised the data it
  was handed has not passed — the same reasoning as the existing zero-requests rule.

Results carry a 1-based `iteration`, shown in the human log (`[2] ✓ PASS …`) and folded into JUnit
test names — without it, N rows collapse into one testcase and a CI reporter shows only the last
outcome.

**Verification.** 592 tests (was 573) — 19 covering the CSV edge cases, JSON dataset typing and
its error messages, per-row substitution, iteration labelling, cross-iteration isolation, `bail`
across iterations, and the empty/missing dataset refusals. Typecheck 8/8, build 5/5.

Also corrected `CLAUDE.md`/`AGENTS.md`, which still described the pre-iteration-5 auth list and
omitted `tags`/`options` — agents read that file, so a stale copy is a real defect.

### 13 — HAR import

**Gap.** The remaining big importer. A HAR (browser devtools → "Save all as HAR") is the
highest-fidelity record of what an app actually did — the fastest route from "reproduce this bug"
to a committed regression test.

**Change.** `importHar()`, wired to `truspec import har`, `POST /api/import/har` behind a picker
in the web import dialog, and the `truspec_import_har` MCP tool.

The import is deliberately **opinionated**, because a faithful dump is not a usable collection:

- Browser-noise headers are stripped (`sec-*`, `user-agent`, `:authority`, `content-length`,
  `host`, `accept-encoding`, …). Several are actively wrong to replay — `content-length` is
  recomputed by the client and `accept-encoding` would make the recorded body unreadable — and
  keeping the rest buries the two headers that matter under thirty that don't.
- `OPTIONS` preflights are skipped (transport, not API surface), with a count reported.
- Each request asserts **the status that was actually recorded**, capturing observed behavior
  rather than a generic "didn't 4xx".
- `--base-url-var` rewrites the recorded origin to `{{baseUrl}}`, which is what makes the result
  usable against staging rather than only the host it was recorded from.
- Bearer/basic auth is lifted into `auth`; JSON and urlencoded bodies become typed bodies; a
  multipart entry imports its fields *with a warning that a HAR does not store file contents*.

**Verification.** 611 tests (was 592) — 17 core (noise stripping, recorded-status assertion, the
body-type matrix, filtering, origin rewriting, non-HTTP entries, filename de-duplication, non-HAR
input) and 2 web API. Typecheck 8/8, build 5/5.

### 14 — Responsive layout: three real defects found by looking at the app

Ran the UI in a real browser at 1440px and 900px and read the screenshots. Three defects, all
visible without any interaction:

1. **The sidebar clipped its own "export" button at the default width.** `.collection-actions`
   was a non-wrapping flex row of four buttons inside a 270px sidebar; the fourth simply ran off
   the edge. Now wraps.
2. **The spec rail was cut off mid-word at 900px.** The workspace grid's floor
   (270 + 500 + 340) exceeds a 900px window, so `.workspace` scrolled sideways and the rail was
   clipped with no affordance to reach the rest of it. (An existing test asserted the *document*
   didn't scroll, which was true — the overflow was one level down.) The rail is supplementary —
   the `spec` view shows the same thing — so it is the panel that now gives way, computed from the
   live viewport width because the grid columns are an inline style a media query can't reach.
3. **The URL field was squeezed to a ~40px stub at 900px** while `code`/`edit`/`send` kept their
   full width. `.req-top` now wraps and the URL bar has a `flex: 1 1 320px; min-width: 260px`
   floor, so the buttons move to their own line instead.

Added a **manual rail toggle** (persisted) alongside the auto-hide, so the panel can be reclaimed
at any width — panel collapsing is table stakes in Postman and Bruno.

Two pre-existing e2e tests needed updating rather than the code: the code-snippet test still
expected the *unresolved* `{{baseUrl}}` from the old client-side curl builder (the engine now
correctly substitutes it), and the import test's `input[type=file]` selector became ambiguous once
HAR import added a second picker — both hidden inputs now carry `aria-label`s, which also makes
them announceable.

**Verification.** 4 new e2e tests pinning each defect; full e2e suite 71/71, unit 611, typecheck
8/8, build 5/5.

### 15 — Response viewer: a filter box that is also a path picker

**Gap.** The response body was a static `<pre>`. No search, no raw view, no wrap control — and,
more importantly, no path off the screen: reading a body is only half the job, and every client
leaves the other half (turn what you found into an assertion) to hand-retyping the path.

**Change.** A `ResponseBody` viewer with `pretty`/`raw` and `wrap` toggles, and a filter box that
does two things depending on what you type:

- **plain text** — narrows the body to matching lines with a count, so a large body stays
  navigable;
- **a `$.`-prefixed JSONPath** — evaluates the *real* engine against the *real* response, shows
  exactly what it selects, and when it selects exactly one value offers **`+ assert`** and
  **`+ capture`**, which write straight into the request draft (`{ type: jsonpath, path, exists }`
  / `capture: { name: path }`, with the variable name pre-filled from the last path segment).

That closes the loop the format is built around — you discover a path by looking at a response and
commit it as a machine-checkable assertion without ever retyping it.

Getting the engine into the browser needed a new `@truspec/core/jsonpath` entry point: the
`runner` barrel would have dragged the assertion engine and OpenAPI reader into the bundle, which
is far more than a UI needs. The new module has no imports at all.

**Verification.** 5 e2e tests (match reporting, no-match, assert round-trip, capture round-trip
with the pre-filled name, text filtering, the toggles). Full e2e 76/76, unit 611, typecheck 8/8.

Two of those tests initially failed and the code was right: they asserted on `textContent` where
the values live in an input's `value`. Worth recording, because "the test failed" is not the same
as "the feature is broken".

### 16 — Accessibility audit extended to every surface, and what it found

**Gap.** The axe audit covered exactly three screens (main, editor, light theme). Every panel added
since — and several older ones — had never been scanned. An audit with a fixed scope stops being an
audit the moment the UI grows.

Extending it to the code panel, response filter, every request tab (auth/body/assertions incl. the
new OAuth2 and multipart editors), the import dialog, and the narrow layout surfaced **six real
defects**:

1. **`nested-interactive` on every open tab.** Each tab was a `role="button"` div wrapping the
   close button, so a screen reader could not reach the close control — and, separately, the tab
   was **keyboard-inert**: `tabIndex={0}` with no key handler looks focusable but does nothing on
   Enter. Rebuilt as two sibling buttons in a non-interactive `<nav>`, which fixes both. Not a
   `role="tablist"` on purpose: that requires every child to be a tab (close buttons are not) and
   implies tabpanels this UI doesn't have; `aria-current="page"` is the honest marker for open
   documents.
2. **`--fg` was never defined**, yet five rules used `color: var(--fg)`. Every hover/active
   emphasis they were written to produce silently did nothing. → `--text`.
3–5. **Three contrast failures** on accent-as-text (`.badge-link` 3.85, `.dirty-bar` 3.94,
   `.time` 4.49). Fixed by splitting the accent's two roles: `--lime`/`--amber` fill, and new
   `--lime-ink`/`--amber-ink` for text, dark-theme-transparent and darkened for light.
6. **An unlabeled file input** (the Bruno folder picker) and **three unlabeled assertion inputs**
   (status value, status list, duration limit).

Also removed a **latent palette trap in both themes**: `--dimmer` cleared AA on `--panel` but not
on `--panel-3` (4.36 light / 4.31 dark). That had been handled by a *comment* telling future
authors not to put muted text on `--panel-3` — a rule nobody can follow while writing a new
component. Both values were raised so the constraint no longer exists.

One "violation" was **not** a defect and is recorded as such: a modal fades in over 160ms, and an
element mid-fade composites both its text and background against what's behind it, so axe measured
a ratio no user ever sees. The suite now settles `getAnimations()` before scanning — the difference
between auditing the UI and auditing a transition.

**Verification.** 5 new a11y scans (9 total), all zero-violation. Full e2e 81/81, unit 611,
typecheck 8/8, build 5/5.

### 17 — Keyboard: make the shortcuts global, and discoverable

**Gap (two).** Send (`⌘↵`) and save (`⌘S`) were bound *inside the request view*, so they only fired
while focus happened to be there — press either after clicking the sidebar and nothing happened,
with no feedback. And the app advertised none of its shortcuts: an unlisted shortcut is one only
its author uses.

**Change.**

- Send and save are now **window-level**, as in any editor. The handler binds once and reads its
  actions from a ref assigned during render, so it neither re-subscribes on every keystroke nor
  reaches a not-yet-initialised binding.
- New tab shortcuts: `⌘/Ctrl+Alt+←/→` to move between tabs (wrapping) and `⌘/Ctrl+Alt+W` to close
  one — deliberately avoiding `⌘W`/`⌘1..9`, which the browser owns.
- **`?` opens a shortcut reference**, generated from a single table so the list and the bindings
  cannot drift apart. It is suppressed while typing, since `?` is also just a character.
- The command palette gained seven actions that were previously reachable only by knowing where
  their button lives: run/save the open request, new request, new folder, toggle theme, show/hide
  the spec panel, and the shortcut reference.

**Verification.** 5 e2e tests, including the two that pin the actual bug — save and send working
*from outside the request view* — and one asserting `?` stays inert while typing. Full e2e 86/86,
unit 611, typecheck 8/8, build 5/5.

### 18 — `truspec run --watch`

**Gap.** No local loop. Because collections are plain files, a watcher is the natural companion to
the format — and re-running by hand after every edit is the friction that keeps people in a GUI.

**Change.** `--watch` re-runs on any change to a request, environment, `.env`, or spec under the
collection. Three behaviors matter more than the watching:

- **Debounce** — one editor save typically emits three filesystem events (temp file, rename,
  chmod); without it, one save runs the collection three times.
- **No overlap** — a change arriving *during* a run is remembered and fires exactly once when it
  finishes. Otherwise a slow collection plus a fast typist queues runs faster than they complete.
- **A throwing run doesn't end the watch.** Writing the test for this found a real bug: the
  callback runs detached, so an error escaping it surfaced as an **unhandled rejection and would
  have taken the process down** — the opposite of what a watcher is for, since a broken file is
  precisely when you keep editing. Now caught and reported through an `onError` hook.

`run` was refactored so one pass is a `once()` function reused by both modes, rather than
duplicating the reporting and exit-code logic.

**Verification.** 8 tests with an injected watcher *and* clock, so nothing depends on real
filesystem events or real time: relevance filtering, which directories get watched, debouncing,
the overlap guard, teardown ignoring an armed timer and a late event, and the throwing-run case.
619 unit tests, typecheck 8/8, build 5/5.

### 19 — TLS and proxy: flags, deliberately not request fields

**Gap.** No way to reach a staging box with a self-signed certificate, an internal CA, mutual TLS,
or a corporate proxy — a hard blocker in exactly the environments a CI gate runs in.

**Design decision worth stating.** These are **CLI flags and environment variables, never
request-file fields**. Whether to trust a certificate or route through a proxy is a property of
*where you are running*, not of the request; a committed file saying "skip TLS verification" is a
liability that outlives the afternoon it was needed. curl, git and every CI tool draw the line in
the same place, and it keeps the format honest.

`--insecure/-k`, `--proxy`, `--ca` (repeatable), `--client-cert`, `--client-key`,
`--client-key-passphrase`, plus `TRUSPEC_PROXY`/`HTTPS_PROXY`/`NODE_EXTRA_CA_CERTS` from the
environment with flags winning per field. `--insecure` always warns on stderr: a run that silently
accepted any certificate would be a gate that proves nothing.

`NODE_TLS_REJECT_UNAUTHORIZED` is **not** honored, on purpose — disabling verification should be
visible at the call site, not inherited from an ambient variable set for an unrelated tool.

Implemented with `undici` (the same library Node's own global `fetch` is built on) as a **CLI**
dependency, injected through the `fetch` seam core already had — core keeps its two runtime
dependencies. A certificate path that can't be read fails immediately with a clear message rather
than at connect time.

**Verification.** 12 tests — environment precedence, per-field merge, the no-op case, a real
request through a built dispatcher, path resolution, the missing-file error, and the two CLI paths
(warning, transport error). 631 unit tests, typecheck 8/8, build 5/5.

### 20 — `truspec docs`, and the double-base-URL bug it exposed

**Gap.** A collection is readable YAML, but nothing rendered it as *documentation* — the artifact
you hand a teammate or publish next to the code. Postman's equivalent is a cloud page; for a
local-first tool the right answer is a file in the repo.

**Change.** `truspec docs [dir]` renders endpoints, parameters, headers, bodies, assertions,
captures, the linked spec operation and a runnable example per request, grouped by folder with a
linked table of contents. Also a `truspec_docs` MCP tool.

**The output is deterministic** — no timestamp, no absolute paths, no run data. That is the design
decision, not an omission: the document lives next to the collection and is reviewed in a diff, and
a "generated on ⟨date⟩" line would make every regeneration a change, which is precisely how
generated docs stop being regenerated. `git diff --exit-code docs/api.md` is then a usable CI check.

Writing it exposed a **real bug in `resolveRequest`**: a request whose URL starts with
`{{baseUrl}}`, in a folder that also sets `baseUrl`, got the base applied twice —
`{{baseUrl}}/{{baseUrl}}/posts` in *every generated snippet*. The relative-URL test is
`/^https?:\/\//`, which an unsubstituted template fails. It only bites under `onMissing: "keep"`
(codegen, previews, docs); at run time the variable is substituted first, so the run was always
correct and nothing caught it. A URL still beginning with a placeholder is now treated as
absolute, which is a no-op at run time and correct everywhere else.

**Verification.** 13 docs tests — including one asserting byte-identical output across two runs
with no date and no absolute path anywhere, one pinning the double-base-URL regression, and one
that documents this repository's own `examples/blog` end to end. 644 tests, typecheck 8/8,
build 5/5.

### 21 — Pay back the coverage debt, and raise the gate that let it accrue

**Re-analysis with fresh eyes.** Twenty iterations added roughly 3,000 lines. Running
`pnpm test:coverage` showed the bill: **functions had fallen from 98.3% to 89.94% — below the
project's own 90% threshold** — and lines from 95.18% to 91.88%. New code had shipped with tests
for its *behavior* but not for its edges.

**Change.** Tests for the least-covered modules, which turned up three more real bugs:

1. **`exportPostman` silently dropped `multipart` bodies and `oauth2` auth.** Both were added in
   earlier iterations and the exporter was never updated; the switch simply fell through and the
   request exported with no body / no auth. Now converted (Postman's `formdata` with `type: file`,
   and its `oauth2` key/value block), with warnings for the fields Postman genuinely cannot
   represent (`audience`, `extra`, transport `options`) rather than losing them quietly.
2. **Watch mode watched a single-file target as a file, not its directory** — so a *sibling
   request added later* was never noticed, which is the change a watcher is most useful for.
3. `web/src/tree.ts` — the sidebar's whole tree/filter model — had **0% coverage**. It now has 16
   tests, including the "folder with no requests yet is still visible" case.

Also added: a `web/src/api.ts` client suite that pins the wire contract against the server routes
(a renamed route would previously have gone unnoticed until someone clicked the button), plus CLI
coverage for `docs`, the HAR/curl `import` paths, and the new MCP tools.

**The durable fix is the threshold.** 90/85/90/90 sat far enough below the real numbers that all
of that could land before anything complained. Raised to **95 lines / 87 branches / 96 functions /
95 statements**, just under the current figures, so a regression trips on the commit that causes
it rather than twenty commits later.

**Verification.** Coverage now 95.43% lines, 87.78% branches, 97.01% functions — above where the
campaign started. 687 tests (was 644), typecheck 8/8, build 5/5.

### 22 — Dogfood the new commands as CI gates

**Observation.** Twenty-one iterations added `lint` and `docs`, and this repository — which ships
two example collections — did not use either. A tool whose own examples are not checked by it is a
tool nobody has actually run in anger.

**Change.** Two gates on every push and PR:

- **`truspec lint examples --strict`** — even a *warning* fails. If TruSpec's own examples cannot
  pass TruSpec's linter, either the linter is wrong or the examples are, and both are worth
  knowing on the commit that caused it.
- **`truspec docs` regenerated and `git diff --exit-code`'d.** This turns the determinism claim
  from a docstring into something CI proves on every push, *and* keeps the committed example docs
  (`examples/*/API.md`, now linked from the README) in sync with the collections they describe.

The CI comment describing the coverage thresholds was also stale (it still said ≥90/≥85); a
comment that misstates the gate is worse than none.

**Verification.** Both gates pass locally; `truspec docs` verified byte-identical across two runs.

### 23 — Insomnia importer

**Gap.** The last major competitor format. Postman, Bruno, curl and HAR were covered; a team on
Insomnia had no on-ramp at all.

**Change.** `importInsomnia()`, wired to `truspec import insomnia`, `POST /api/import/insomnia`
behind a picker in the web dialog, and the `truspec_import_insomnia` MCP tool.

Insomnia stores a collection as a **flat `resources` array with `parentId` pointers**, not a tree,
so folders are reassembled by walking parents — with a cycle guard, because a malformed export can
point a group at itself and a naive walk would hang. Beyond the shape:

- **Disabled rows are skipped.** Insomnia keeps headers and query parameters the user switched
  off; importing them would send headers someone explicitly turned off.
- `{{ _.var }}` (v5) and `{{ var }}` (v4) both normalize to `{{var}}`.
- Bodies map across all four shapes, including multipart *with its file parts*.
- An OAuth2 block is imported only for the grants a machine can complete unattended; an
  authorization-code flow needs a browser, so it is reported rather than imported as a block that
  could never run — the same line drawn when OAuth2 was added.
- Output is sorted, so the written files (and any diff of them) are reproducible regardless of the
  export's own ordering.

Also reordered `import`'s source list to `postman|bruno|insomnia|curl|har` — collection formats
first, then the two single-request/recording formats.

**Verification.** 22 tests — 18 core (folder reassembly, the cycle guard, disabled rows, template
normalization, every auth and body shape, the browser-grant refusal, filename de-duplication,
stable ordering, malformed input), 2 web API, 1 MCP, 1 CLI. Coverage held at 95.39% lines /
96.56% functions. 705 tests, e2e 86/86, typecheck 8/8, build 5/5.

### 24 — `truspec env`: inspect and diff environments

**Gap.** Environments are central to the format, and there was no way to see one without opening
the file — let alone compare two.

**Change.** `truspec env` lists every environment with its variable/secret counts and an
unresolved-secret warning; `truspec env <name>` shows one; `truspec env --diff a b` compares two.
Also a `truspec_environments` MCP tool.

Two decisions carry the design:

- **Secret values are never printed or returned** — only whether each resolves, and from where (OS
  environment vs project `.env`). This output goes into terminals and gets pasted into issues; a
  tool that prints a token to help you debug a *missing* token has caused a worse problem than the
  one it solved. There is a test asserting no value leaks through either source.
- **`--diff` exists for one boring failure**: staging declares a variable production does not, so
  the collection runs green everywhere except where it matters. A name present on only one side is
  reported as prominently as a changed value, and a name that is a plain variable on one side and
  a *secret* on the other is flagged as the real difference in kind that it is.

**Verification.** 25 tests — 13 core (resolution precedence, the no-leak assertion, unparseable
files, subdirectory lookup, stable ordering, every diff case), 10 CLI, 2 MCP. 731 tests, coverage
held at 95.39% lines / 96.64% functions, typecheck 8/8, build 5/5.


### 25 — an unresolved secret is visible before the run, not after it

**Gap.** Iteration 24 made secret resolution inspectable from the terminal, but the web UI still
told you nothing until a run had already failed. The sequence was: pick an environment, build a
request, send it, read a 401, then go hunting for which of the declared secrets has no value. Every
part of that is knowable before the first byte goes out.

**Change.** `GET /api/environments` returns the same status-only report the CLI prints, and the UI
consumes it in two places:

- A `⚠ N unset` badge sits next to the environment picker whenever the selected environment has
  unresolved secrets. It is a button — clicking it opens the environment manager at the problem
  rather than making you find it.
- Inside the manager, every declared secret carries a `✓ set` / `not set` chip, with a tooltip
  naming where the value came from (OS environment or project `.env`), and each environment row in
  the list shows its own unset count.

The report is refreshed on load and on every environment change, so the badge tracks the
environment you are actually about to run against.

**The constraint that shaped it.** The response crosses into a browser, so it carries names and
resolution status and nothing else — never a value, from either source. That is asserted in the API
test directly (`JSON.stringify(response)` must not contain the fixture's value) and again in the
browser, because "the modal shows status" and "the modal shows the secret" are one CSS change
apart.

**Verification.** 3 e2e tests (badge present before any run; the badge opens the manager; the modal
shows status and never a value) and 1 API test. The shared e2e fixture now declares an unresolved
secret, so the whole browser suite exercises the new state: 89 e2e passing, 734 unit tests,
coverage 95.39% lines / 87.14% branches / 96.39% functions — all above the gate — typecheck 8/8.

### 26 — a failed request that says what actually went wrong

**Gap.** Point a request at a host that isn't listening and TruSpec said:

```
error: Request failed: fetch failed
```

That is the most common failure anyone hits, and the message contains no information. `fetch`
reports every network failure as those same five characters and buries the real reason — an
`ECONNREFUSED`, an expired certificate, a DNS miss — in a `cause` nobody was reading. Postman,
Insomnia and curl all name the cause; we named nothing.

**Change.** `describeTransportError()` walks the cause chain (including `AggregateError.errors`,
which is what Node throws when a dual-stack host fails on both addresses, and where `cause` alone
unwraps to nothing) and turns the errno into a sentence with the host in it:

| before | after |
|---|---|
| `Request failed: fetch failed` | `Connection refused by 127.0.0.1:4000 — nothing is listening on that port` |
| `Request failed: fetch failed` | `Host not found: api.staging — check the hostname, or the variable that produced it` |
| `Request failed: fetch failed` | `TLS certificate for api.staging:8443 is self-signed (use --insecure, or --ca <file> to trust it)` |
| `Request failed: fetch failed` | `Refusing to connect to 127.0.0.1:1: the HTTP client blocks that port number outright` |

Timeouts are matched by `name` rather than errno, because `AbortSignal.timeout` throws a
`DOMException` with no `code` at all. An unrecognised cause falls through to the deepest real
message, which is still strictly better than the wrapper's.

**The second half, which the first half made necessary.** Those TLS messages name `--insecure` and
`--ca` — flags that only `truspec run` accepted. Following that advice from the web UI would have
led nowhere, and the underlying inconsistency was worse than the wording: `run` honored
`HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`, `serve` silently ignored them, so a collection could pass
in CI and fail in the browser client against the same host with nothing on screen to explain the
difference. `truspec serve` now takes the same transport flags and environment variables and hands
the configured transport down through `startWebServer` → `ApiContext` → `runPath`. `--insecure`
warns there too, and more sharply: it holds for every request until the server is stopped.

**Verification.** 11 unit tests over the describer (every errno, the timeout `DOMException`, the
`AggregateError` shape, a cause cycle, the unknown-cause fallback), a web API test proving the
injected transport is the one that actually sends, another proving a real refused connection is
reported by name rather than as `fetch failed`, and 3 CLI tests for `serve`'s flags. 750 unit tests,
89 e2e, coverage 95.46% lines / 87.41% branches / 96.44% functions — up on all three — typecheck
8/8, own lint/docs/schema gates clean.

### 27 — one typo should not take the run down, and should say what you meant

**Gap.** Three problems, all reachable by mistyping one key:

```
$ truspec run ./api
Error: Invalid TruSpec request:
  <root>: Unrecognized key(s) in object: 'headrs'
```

That is the entire output for a 40-request collection. The run aborted at the first bad file
(`files.map(parse)` threw from inside the map), **the message named no file**, and the 39 requests
that were fine never ran. Meanwhile the web UI called `/api/state`, which has always reported bad
files with their paths — and displayed none of them, so a broken file was simply absent from the
sidebar, which reads as *deleted* rather than *broken*.

**Change.**

1. **The run survives it.** `runPath` collects `parseErrors: [{ file, error }]` instead of throwing,
   runs everything that did parse, and reports `ok: false` regardless — a file nobody could read is
   not a file that passed. Every reporter renders them: the human report names the file, the HTML
   report gets a card, and JUnit emits a **failing testcase**, because a CI report that silently
   omits an unreadable file reads as clean, which is the one outcome a gate must never produce.
   `run` no longer claims "no .tspec.yaml requests found" when the requests are right there and
   simply do not parse.
2. **The error says what you meant.** `.strict()` exists to catch `headrs:` before it silently does
   nothing at run time; naming the key it was one character from is the rest of that job:
   `Unrecognized key(s) in object: 'headrs' (did you mean 'headers'?)`. Candidates come from the
   schema **at that path**, narrowing a discriminated union by its discriminator — `equals` is
   offered for a mistyped `jsonpath` assertion, and `ltMs` is *not* offered for a `status` one,
   because a suggestion that doesn't parse is worse than none. There is a test asserting that
   taking the advice produces a file that parses.
3. **The UI shows it.** Unparseable files now appear as a labelled block at the top of the sidebar
   tree, each expandable to the full error including the suggestion.

**One thing the tests taught me.** The first distance function was plain Levenshtein, which charges
**2** for a transposition — so `alpah` scored as further from `alpha` than `alphaa` does, and the
most common typo in existence fell outside the threshold. Switched to optimal string alignment
(adjacent transposition = 1 edit), which is also what lets the threshold stay tight enough to
refuse unrelated keys.

**Verification.** 21 new tests — 15 over suggestions (per-path narrowing, the union branches, every
schema wrapper, the "advice must parse" invariant), 6 over surviving a bad file mid-run — plus 3
reporter tests, 2 CLI tests and 3 e2e. 776 unit tests, 92 e2e, coverage 95.50% lines / 87.57%
branches / 96.51% functions, typecheck 8/8, own lint/docs/schema gates clean.

### 28 — the agent surface had no way to read what it was editing

**Gap.** "Agent-native by design" is one of this project's four stated principles, and the MCP
server is where that promise is kept. It exposed 19 tools — and **no way to read a single request**.
An agent could list summaries (name, method, url) and patch a request, but never see one. That
matters more than it sounds, because `truspec_update_request` merges one level deep: patching
`headers` to add a trace header silently replaces every other header. Safe patching required
already knowing every field you weren't changing, which is to say it wasn't safe. There was also no
way to validate a draft without writing it, no delete (every other CRUD verb was there), and no way
for an agent to learn the file format from the server rather than from whatever it remembered.

**Change.** Four tools, and one fix to an existing one:

| tool | why |
|---|---|
| `truspec_read_request` | the parsed object *and* the raw YAML; for a file that doesn't parse it returns the error **and** the raw text, so the agent can still fix it |
| `truspec_validate_request` | check a draft without writing; errors name the key a typo was meant to be (iteration 27), so a failure is a correction rather than a rejection |
| `truspec_delete_request` | completes CRUD; refuses any path that is not a `.tspec.yaml`, so a mistyped path can't remove a spec or an environment |
| `truspec_format_reference` | the JSON Schema for request/folder/environment, **generated from the Zod schema that validates** rather than read off disk — a reference that can drift from the validator is worse than none, and the package layout differs between a checkout and an install |

`truspec_update_request` now treats `null` as "remove this key". Without it a merge could never
clear an optional field, so dropping `auth` meant deleting and recreating the file. Its description
now states the shallow-merge semantics instead of leaving them to be discovered.

**Also.** The published tool count was documented as 10, 11 and 19 in four different places, none
of them right. All corrected to 23, and `docs/mcp.md` gained the new rows plus a "read before you
patch" note.

**Verification.** 7 new MCP tests driven through a real in-memory client↔server pair — including
that a path escaping the workspace is refused for both read and delete, and that the format
reference's properties match the validator's. 783 unit tests, coverage 95.55% lines / 87.62%
branches / 96.55% functions — up on all three — typecheck 8/8, own lint/docs/schema gates clean.

### 29 — three lint rules, found by asking what a collection can be statically wrong about

**Gap.** The linter had 8 rules. I wrote four deliberately-broken requests and ran them; it caught
one of the four. The three it missed:

- **A `GET` with a body.** `fetch` refuses this outright — *"Request with GET/HEAD method cannot
  have body"* — every single time, so the request can never run under any circumstances. That is
  not a style note; it is a file that is statically, unconditionally broken, and the linter said
  nothing about it.
- **A `Content-Type` header that contradicts the body.** `headers: { Content-Type: application/xml }`
  with `body: { type: json }` sends JSON bytes labelled as XML — the explicit header wins in the
  resolver, by design. The server answers 400 and says nothing about why.
- **A capture nobody reads.** `capture: { authToken: … }` in one request and `{{token}}` in the
  next is one rename applied on one side. The linter reported the second half (`undeclared-var`)
  and never the first, so the message pointed at the wrong file.

**Change.** Three rules — `body-on-bodiless-method` (**error**, since the request cannot be sent),
`content-type-conflict` and `capture-never-used` (warnings). The Content-Type rule matches by
*format family*, not by string equality: `application/vnd.api+json` and
`application/json; charset=utf-8` for a JSON body are exactly what the override exists for and are
not flagged; `application/xml` is.

**And one message that was actively misleading.** `undeclared-var` said `{{token}}` was *"not
captured by an earlier request"* even when a request captured it and simply ran **later** — sending
the reader to look for a capture that was right there in the next file. It now names that file and
the fix: `{{token}} is captured by 01-login.tspec.yaml, but that request runs later — raise this
request's order, or lower that one's.` Same warning, opposite amount of help.

**Verification.** 12 tests, including that a narrower content type of the same family is *not*
flagged (the false positive that would make the rule worth disabling), that `body: { type: none }`
on a GET is fine, and that each rule is in the `--list-rules` registry and respects `--disable`.
795 unit tests, coverage 95.57% lines / 87.65% branches / 96.55% functions, typecheck 8/8, and the
project's own examples still pass `truspec lint --strict` against the larger rule set.

### 30 — the fields the CLI runs on that the UI could not show

**Gap.** `tags` and `options` are in the schema, and `truspec run --tag smoke` has shipped since
the field existed. The web UI showed neither and could edit neither. Two consequences:

- **The subset your CI runs was invisible in the client you author in.** No way to see which
  requests carry `smoke`, and no way to add one without leaving for a text editor.
- **A timeout was indistinguishable from a slow endpoint.** `options: { timeoutMs: 5000, retries: 2 }`
  changed how the request was sent, and nothing on screen said so.

I checked the save path first, because the dangerous version of this gap is silent data loss: if
the UI wrote back only the fields it knew about, opening a tagged request and changing its URL
would delete the tags. It doesn't — `const { raw, ...request } = draft` spreads everything — but
**nothing asserted it**, and it is one "tidy up the type" change away from being true. There is now
an e2e test that edits an unrelated field and asserts both survive.

**Change.** A `TagsEditor` (removable chips beside the request name, `+ tag`, comma-separated input
split into several because that is what people type) and an `OptionsEditor` (timeout, retries,
retry delay, max redirects, follow-redirects) below the description. Both clear their key entirely
rather than leaving `tags: []` or `options: {}` behind — an empty block is noise in a diff that
means nothing.

**Two things the tests caught.** The options button reused the `.order-add` class; the existing
`order-editor` e2e then matched two buttons and failed on strict mode. Two unrelated controls
sharing a selector is precisely how that happens, so it got its own class rather than a
`.first()` in the test. And `docs/editors.md` still said *"the web UI is read-and-run focused
today; in-UI request editing is on the roadmap"* — untrue for a long time, and now rewritten to
list what is actually editable.

**Verification.** 3 e2e tests (chips add/remove and round-trip to the file; options edited and
cleared; the no-data-loss regression). 95 e2e passing including the full axe sweep, 795 unit tests,
coverage 95.57% lines / 87.65% branches / 96.55% functions, typecheck 8/8, dogfood gates clean.

### 31 — a shutdown that never finished, found by CI rather than by reading

**Gap.** CI went red on three consecutive commits with two different symptoms: once an autocomplete
assertion, twice `Tearing down "app" exceeded the test timeout of 30000ms` in `broken-file.spec.ts`.
The full suite passed locally every time, twice over. The tempting reading is "CI is flaky" — and
that reading is wrong.

`server.close()` does not do what its name suggests. It stops accepting connections and sweeps the
sockets that are idle *at that instant*, but it then waits, with no timeout, on any socket that is
connected and has not yet sent a request. Chromium opens exactly those speculatively (preconnect),
so a single open tab can make `close()` never resolve. Reproduced directly: connect a bare
`net.Socket`, send nothing, call `close()` — it hangs indefinitely, on both the web server and the
mock server.

That is not only a test problem. The mock server's `close()` is what `/api/mock/stop` awaits, so
the UI's stop button hangs on the same condition — and the single close-time sweep means even a
socket that parks *after* close() (its response having just finished) holds shutdown open.

**Why it surfaced now.** Playwright tears fixtures down in reverse order of setup. The 81 older
specs destructure `{ app, page }`, so the browser closes first and the server never sees a live
socket. The two specs added in iterations 27 and 30 wrote `{ page, app }` and so tore the server
down first — exposing a latent defect that had been there the whole time, intermittently, because
whether Chromium is holding an unused socket at that instant is a race.

**Change.** A shared `closeHttpServer` (new server-only `@truspec/core/http` subpath, used by both
servers): stop accepting work, retire sockets as they fall idle rather than once, give anything
genuinely in flight a 1s grace, then destroy what is left. The promise is now guaranteed to settle.
The two specs were also put back on the `{ app, page }` order, with a comment in `fixtures.ts`
saying why — the fix makes the order survivable, but browser-first is still the right teardown.

**Verification.** 5 unit tests, one per failure mode — the preconnect socket that caused this, a
parked keep-alive socket, an in-flight response that must still complete, a double close, and a
convergence assertion that shutdown returns as soon as the socket falls idle instead of sitting out
the whole grace (which is what a single sweep did: 1007ms → 132ms). Both original repros now
terminate. 800 unit tests, 95 e2e, coverage 95.59% lines / 87.64% branches / 96.56% functions,
typecheck 8/8, dogfood lint + deterministic-docs + schema gates clean.

### 32 — two modules that no code search could see

**Gap.** Grepping the runner for `timeoutMs` returned, among normal results, the line
`grep: packages/core/src/runner/oauth.ts: binary file matches` — no line number, no content. The
file holds a single raw NUL byte. `cookies.ts` holds four.

The NUL itself is the right idea: both modules build a compound key out of user-controlled parts
(`grant|tokenUrl|clientId|…` for the OAuth token cache, `domain|path|name` for the cookie jar) and
separate them with a character that cannot occur in any part, so two different tuples can never
collide into one key. The bug is the *encoding*: the separator was written as a literal byte
instead of the escape `\u0000`. That makes `file` classify the source as binary, and grep and
ripgrep then skip it in silence — no error, no match, just absence.

So the token cache and the cookie jar, the two most security-sensitive modules in the runner, were
invisible to every code search in the repository. An agent following this repo's own CLAUDE.md and
grepping for a symbol would be told, truthfully and uselessly, that it does not appear. Two of the
NULs were inside a doc comment (`Keyed by domain<NUL>path<NUL>name`), where they were never a value
at all — only unreadable documentation.

**Change.** Five raw bytes replaced by `\u0000` in code and by a readable `\0` in the comment. The
runtime values are identical; the files are now plain text and searchable.

**Change (guard).** A test that walks every tracked source file (via `git ls-files`, so build
output can't skew it), reads it as latin1 so a stray byte is never smoothed into U+FFFD, and fails
naming file and line if any control character other than tab, LF or CR appears. Verified both ways:
green on the fixed tree, and on reintroducing the original byte it reports
`packages/core/src/runner/oauth.ts:84 contains U+0000`.

**Verification.** 801 unit tests (the existing oauth and cookie suites cover the key-building paths
and are unchanged), coverage 95.59% lines / 87.64% branches / 96.56% functions, typecheck 8/8,
dogfood lint + deterministic-docs + schema gates clean.

### 33 — the editor could tell you nothing at all

**Gap.** The VS Code extension had not been touched by this campaign, so it still behaved the way
the rest of the product did before iterations 25 and 27.

Its CodeLens is registered for `**/*.tspec.yaml` — which matches `folder.tspec.yaml`, a *folder
config*, not a request. So every folder config in the workspace offered a **▶ Run** button. Clicking
it calls `runPath` on that file, which parses it as a request and fails:
`url: Required`, `Unrecognized key(s) in object: 'baseUrl'`. Confirmed by running it directly.

And then the panel threw that away. `renderResults` only ever rendered `result.results`, so a run
with zero rows and one parse error displayed **"no requests. · 0 passed · 0 failed"** — a button
that cannot work, wired to a panel that says nothing went wrong. `missingSecrets` was dropped the
same way, so a run failing on an unresolved secret showed only unexplained auth errors.

**Change.** Three things, in the order a user meets them: the ▶ Run lens is no longer offered on a
`folder.tspec.yaml`; invoking the command on one anyway now says *"folder configuration, not a
request — use Run collection"* rather than running; and the results panel renders what the run
actually reported — a "could not read" section naming each unparseable file with its error, an
"unresolved secrets" section, and an `N unreadable` count in the summary. "no requests." is now
reserved for a run that genuinely had nothing to report.

**Verification.** 6 new tests. The two renderer tests were checked against the unfixed file first
and both fail there, so neither is vacuous. 806 unit tests, coverage 95.60% lines / 87.72% branches
/ 96.56% functions, typecheck 8/8, dogfood lint + deterministic-docs + schema gates clean. The
extension README and `docs/editors.md` both claimed the lens appears on *every* `.tspec.yaml`;
both now say what it actually does.

### 34 — the suggestion menu that dismissed itself

**Gap.** With the teardown hang fixed, CI came back green on everything except one test, which had
by then failed twice on CI and never once locally: `var-autocomplete-auth.spec.ts:10` types `{{ba`
into the bearer-token field and gets no suggestions at all — `14 x locator resolved to 0 elements`
across the full five seconds. Not the wrong suggestions. None, and never recovering.

I could not reproduce it: eight consecutive runs of that spec with every core pinned at 100%, and
two full-suite runs under the same contention, all passed. So rather than call it flaky, I went
looking for what in the component could produce exactly that signature — open, then permanently
closed — and found it.

`VarAwareInput` registered a **capture-phase `scroll` listener on `document` whose only job was to
close the menu**. Any scroll event anywhere in the document, from any source, dismissed a menu the
user was mid-selection in, with no way back except retyping `{{`. The original reasoning was that
re-measuring on every scroll tick was not worth the churn — but the same comment notes the menu is
only open for a few keystrokes, which bounds that cost to almost nothing. And the cost of being
wrong is unbounded: a reflow that scrolls an ancestor closes the menu invisibly, which is precisely
"typed the right thing, got no suggestions".

**Change.** Scrolling now repositions the menu against the input instead of dismissing it, closing
only when the input has actually scrolled out of the viewport. Window resize gets the same handler;
it was not handled at all before, so resizing left the menu stranded away from its input.

**Honesty about the cause.** This is the most plausible mechanism for the CI failure and it is a
genuine defect on its own merits, but I did not reproduce that failure locally and cannot prove
this was it. If a non-reproducible failure recurs here after this, it needs its own investigation.
Deliberately not papering over it with `retries` in the Playwright config — a real hang has already
hidden behind "CI is flaky" once in this campaign.

**Verification.** 2 e2e tests, both written first and confirmed failing against the unfixed build
(one scroll event destroyed the menu; the second test could not click a suggestion at all). 97 e2e
now passing, 806 unit tests, coverage 95.60% lines / 87.72% branches / 96.56% functions, typecheck
8/8, dogfood gates clean.

### 35 — a desktop app that crashed instead of explaining

**Gap.** The Tauri desktop app was the last surface this campaign had never opened. Its sidecar
launcher — the code that starts the bundled Node server the whole window depends on — handled
every failure with `.expect()`. Four of them: the bundled server script missing, the client assets
missing, the `node` sidecar not declared, and the spawn itself failing.

A panic there is not an error message. `start` runs from Tauri's `setup` hook and from a menu
action, so a panicking sidecar means the user double-clicks the app and gets a window that never
appears, or one that never navigates anywhere. The likeliest real causes — a bundled `node` that
macOS quarantined, or one that lost its execute bit to an antivirus or a bad unzip — are precisely
the ones a user cannot diagnose and would report as "it just doesn't open".

`CommandEvent::Terminated` was worse: logged, and nothing else. A sidecar that dies on its own
after a successful start left the window sitting on whatever it last showed, permanently, with no
indication anything had happened.

**Change.** Every failure path now shows an error dialog naming what is missing and what to do
about it, and returns instead of unwinding. An unexpected sidecar exit reports itself the same way
— guarded by a generation counter on `SidecarState`, so the two cases where the sidecar is killed
*on purpose* (switching collections, quitting) stay silent. The dialog is shown non-blocking;
`blocking_show` on the main thread deadlocks the event loop it waits on.

**Second gap, found while reading.** "New Collection…" scaffolds `folder.tspec.yaml` in Rust, which
cannot import the Zod schema, so `tspec: "0.1"` is a literal there. CLAUDE.md requires a
`SCHEMA_VERSION` bump to ship a migration — but nothing connected that rule to this literal, and the
crate is only compile-checked in CI, never run. A bump would have left the desktop app quietly
stamping the old version onto every collection it creates. There is now a test that reads the Rust
source and asserts every version it stamps equals `SCHEMA_VERSION`; confirmed failing when the
literal is changed to `0.2`.

**Third gap.** CI built the desktop crate but never tested it, and there was nothing to test.
Added three Rust unit tests for the scaffolder (fresh directory, existing files left alone, and a
directory name containing a quote and a colon — the case the JSON-escaping trick exists for), plus
the `cargo test` step that runs them, staged after the sidecar so the build script has what it
needs.

**Verification.** `cargo check` and `cargo test` clean (3/3) against a locally installed
webkit2gtk/GTK toolchain, 807 unit tests, coverage 95.60% lines / 87.72% branches / 96.56%
functions, typecheck 8/8, dogfood gates clean. The dialog paths are compile-verified but not
runtime-exercised — they need a bundled app and a display, which neither this environment nor CI
provides.

### 36 — the CLI knew how to suggest, and didn't

**Gap.** A fresh pass over what the CLI does when a user simply mistypes something. Exit codes were
already right (2 for misuse, 1 for failure, 0 for bare help). The messages were not.

`truspec lnit` answered `Unknown command: lnit` followed by the whole help text, with no suggestion
— even though this project has shipped an edit-distance suggester since iteration 27 and uses it to
say *"did you mean 'headers'?"* about a mistyped key in a file. The CLI's own surface had never been
given the same treatment.

`truspec lint --stict` was worse, because the message was actively misleading: Node's `parseArgs`
answers an unknown option by explaining how to pass a *positional* argument that begins with a dash
(`place it at the end of the command after '--'`). That is accurate and almost never the cause. All
thirteen commands relayed it verbatim, and most did not print their own usage line alongside it, so
the reader was left with neither the right flag nor the list of real ones.

**Change.** `closest()` (the same optimal-string-alignment metric, same tightness — it refuses to
guess rather than guess wrong) now backs both. An unknown command suggests the command; an unknown
option names the command it was given to, suggests the flag, and prints that command's usage. One
shared `argError` replaced thirteen copies of the same catch block.

**What this turned up.** The dispatch lived in `index.ts`, which runs `main(process.argv)` on
import — so no test could import it, and `vitest.config.ts` excluded it from coverage as an
"index.ts re-export barrel". It was neither of those things: it was the entire command routing
table, untested and uncounted, where a copy-paste `case "docs": return driftCommand(rest)` would
have been caught by nothing. The dispatch moved to `dispatch.ts` (`index.ts` stays the published
`bin`, so CI's `node packages/cli/dist/index.js ...` invocations are untouched), and `main` takes
injectable streams. There is now a test that stubs all thirteen command modules and asserts each
name routes to its own handler with the right argv.

**Verification.** 21 new tests. 823 unit tests, coverage 95.70% lines / 87.77% branches / 96.61%
functions — above where this iteration started, having also brought a previously excluded file into
the count. Typecheck 8/8, 97 e2e, dogfood gates clean, and the built binary re-checked against the
exact commands CI runs.

### 37 — the CI step added in 36 caught the test added in 35

**Gap.** `build (windows-latest)` went red on iteration 35's commit:

    thread 'sidecar::tests::quotes_a_directory_name_...' panicked:
    Os { code: 123, kind: InvalidFilename }

My own test, one commit old. It created a directory literally named `we"ird: name` to check that
the scaffolder escapes a name that would otherwise break the YAML — and `"` and `:` are both
illegal in a Windows filename. The test could never have passed on the platform it ran on.

Worth noting what happened here: iteration 35 added the `cargo test` CI step *because* the desktop
crate was built but never tested, and the first thing that step did was fail on a portability
defect in the test that came with it. That is the step working, on its first run.

**Change.** The escaping never needed a real directory. Split `folder_config(name) -> String` out
of `scaffold_collection`, and test it as a pure function — which is both portable and a better
test, since it can now exercise names no filesystem anywhere would accept: a name with a quote and
a colon, one with a backslash (the other character the JSON-escaping trick exists for), and a plain
name that must stay readable rather than being escaped into noise. The two filesystem tests, whose
subject really is the file writing, are unchanged and use platform-legal names.

**Verification.** `cargo test` 3/3 and `cargo check` clean; 824 unit tests including the
cross-language `SCHEMA_VERSION` guard, which still finds the literal in its new home; typecheck
8/8.

### 38 — the same collection, two different answers, depending on the machine

**Gap.** Iteration 37's Windows failure raised the obvious question: what else has never run there?
`ci.yml` runs 827 tests, a coverage gate, a schema gate and two dogfood gates — all on
`ubuntu-latest`, only. The CLI ships on npm, and the desktop app ships Windows and macOS
installers whose entire UI is this web server. Nothing verified either.

I audited before turning anything on, and most of the codebase came back clean: `docs` and the
Postman exporter deliberately normalise with `.split(sep).join("/")`, the web client has a
`normPath` and `buildFolderTree` uses it, and the importers build forward-slash collection paths by
construction. Someone had thought about this.

Two places had not. The web HTTP API returns `relative()` output raw at 11 sites, and the MCP
server at 13. `path.relative()` answers in the host separator — so the same collection served from
Windows hands out `posts\get.tspec.yaml` where Linux hands out `posts/get.tspec.yaml`. The web
client happens to survive it because of `normPath`; **MCP has no such defence**, so an agent on
Windows gets backslash identifiers from a product whose stated premise is being agent-native, and
any agent-side handling that splits on `/` quietly gets one path segment.

**Change.** One `toPosixPath` in `@truspec/core/workspace`, applied at both boundaries, and reused
in the two places that had hand-rolled it. Its `sep === "/"` guard is the point, not an
optimisation: a blanket `replace(/\\/g, "/")` corrupts a POSIX filename that legitimately
contains a backslash, and only Windows can guarantee no filename contains a forward slash.

**Change (the part that makes it verified rather than argued).** A `portability` job runs
typecheck, the full suite and the build on `windows-latest` and `macos-latest`, with
`fail-fast: false` so one platform's failure cannot hide the other's. Deliberately not the
byte-comparison gates — a CRLF checkout would fail `git diff --exit-code` for reasons that say
nothing about the code.

Pre-empting the one failure I could predict: `confine.test.ts` creates a symlink, which Windows
refuses without Developer Mode or elevation. It now skips on `EPERM`/`EACCES`/`ENOSYS` with a
warning naming the reason — loudly, because it guards a security property and "it did not run"
must never read as "it held".

**Verification.** 827 unit tests, 97 e2e, coverage 95.70% lines / 87.75% branches / 96.61%
functions, typecheck 8/8, dogfood gates clean. The cross-platform result is by definition not
verifiable here — that is what the new job is for, and I expect to be fixing what it finds.

### 39 — a mock that said "wrong URL" when it meant "wrong method"

**Gap.** The mock server had never been examined by this campaign, so I probed it rather than read
it: nine requests against the blog example, covering the cases a real client sends.

Two answers were wrong, both in the same way — the mock only matched methods the spec declares
explicitly, and treated everything else as a missing route.

`HEAD /posts` returned **404**, on a path it serves happily via GET. HEAD is GET without the body
(RFC 9110 9.3.2); specs almost never declare it, and clients routinely send it as an existence
check before a GET. Worse for this product specifically: `method: HEAD` is valid in a `.tspec.yaml`,
so you could write a HEAD request that the tool's own mock could never serve.

`DELETE /posts` returned **404 "No mock for DELETE /posts"** — for a path the spec very much
defines. A 404 reads as "you typed the URL wrong" and sends the reader looking in the wrong place,
when the actual answer is "that path exists; the spec doesn't define DELETE on it".

**Change.** HEAD now falls back to the matching GET route, returning GET's status and headers with
an empty body and a `content-length` reporting what GET *would* have sent — and an explicitly
declared HEAD operation still wins over the fallback. A known path asked with an undefined method
now answers **405** with an `Allow` header (and the same list in the JSON body) naming what the
spec does define. A 404 now means what it should: the path itself matched nothing.

Both live in the responder rather than the HTTP server, so every consumer gets them — including the
web UI's mock view, which drives the same engine.

**A test that asserted the bug.** `mock.test.ts` had `it("misses unknown routes")` asserting
`respond("DELETE", "/pets/1")` is `undefined`. Its own name gives away the confusion: `/pets/1` is
not an unknown route, only DELETE on it is. Replaced with an honest unknown-path case plus tests
for the two corrected behaviours and for declared-HEAD precedence.

**Verification.** 830 unit tests, 97 e2e, coverage 95.72% lines / 87.79% branches / 96.62%
functions, typecheck 8/8, dogfood gates clean. Re-probed over real HTTP: HEAD's `content-length`
(64) matches GET's body byte-for-byte and `Allow: GET, HEAD, POST` is correct. Three docs
(`cli.md`, `mocking.md`, `faq.md`) each stated the old "routes not in the spec return 404" rule —
the FAQ entry was titled "The mock returns 404 for a path that's in my spec", which was describing
this bug as if it were expected behaviour.

### 40 — what the Windows job actually found

**Gap.** Iteration 38's `portability` job ran for the first time and failed on `windows-latest`:
9 tests across 5 files. macOS passed. Two of the nine were the test's fault; seven were the
product's, and one of those is the most serious defect this campaign has found.

**`truspec run --grep` selected nothing on Windows.** `--grep` matches a request's name *or its
workspace-relative path*, which is how you select a folder: `--grep "^billing/"`. That path came
from `relative()`, so on Windows it read `billing\Get-invoice.tspec.yaml` and the pattern matched
zero requests. A run that selects nothing still exits 0 — so a Windows CI gate filtering by folder
reported success having tested **nothing at all**. Silent, green, and completely vacuous.

The other six were the same root cause with milder consequences: `initProject` returned
`created`/`skipped` arrays of backslash paths (so `truspec init` printed `created api\health.tspec.yaml`
against docs and its own "Next:" hints that all say `api/health.tspec.yaml`), the HTML report
labelled each case with a backslash path, and lint findings, JUnit `classname` attributes and the
Bruno importer's file keys all did the same. JUnit in particular is parsed by CI systems, so the
same collection produced different test identities depending on the runner.

**Change.** `toPosixPath` — added in 38 for the HTTP API and MCP — applied to the eight remaining
sites that emit a collection-relative identifier. The audit in 38 reasoned about which boundaries
mattered and got two of ten; running it on the actual platform found the rest.

**The two test-side failures.** `serve.test.ts` asserted `/examples\/petstore/` against output that
prints the **absolute** directory being served. A native separator is right there — it is a
filesystem location for a human to paste into Explorer, not a collection identifier — so the
assertion was platform-specific, not the product. Now `[\\/]`, verified against both a
`D:\a\truspec\examples\petstore` and a `/home/x/examples/petstore` string, and against a
non-matching one so it hasn't been loosened into always passing.

**Verification.** 830 unit tests, 97 e2e, coverage 95.72% lines / 87.79% branches / 96.62%
functions, typecheck 8/8, dogfood gates clean, and `truspec init` re-checked end to end. On Linux
every one of these changes is an identity function, which is exactly why none of it was visible
until the job existed — the Windows run is the verification, and it is still pending.

## Iterations 41+ (post-merge)

Iterations 1-40 were merged to `main` as PR #37, green on ubuntu, windows and macos. The campaign
continues from a branch restarted on the merged `main`.

### 41 — "0% covered" with a request for every operation

**Gap.** `coverage` is half of what makes this product spec-*synced*, so I probed it the way I
probed the mock. A collection where every operation had a linked request reported **0%**, and
listed every operation as uncovered with no further explanation.

My first read was that this was a bug, and it is worth recording that it was not. `computeCoverage`
requires `hasAssertions`, deliberately and by its own doc comment: a request that asserts nothing
proves nothing about the contract, so counting it would make the number a lie. The rule is right.

The reporting is what fails. Two entirely different situations print the same line:

- nothing in the collection points at this operation — **write a request**
- a request points at it but asserts nothing — **add an assertion to a file you already have**

Someone who has diligently written a request per operation sees 0% and a list that reads as "you
have done none of this", with nothing to suggest they are one assertion away per line. `--min` in
CI turns that into a failing gate with a misleading explanation.

**Change.** `CoverageReport` gains `unasserted` — the subset of `uncovered` that a request does
point at, each with the request's name and file. The CLI annotates those lines in place
(`✗ GET /health — "Health" (api/health.tspec.yaml) has no assertions; a request that asserts
nothing tests nothing`) and leaves a genuinely absent operation bare. The VS Code coverage panel
draws them amber-with-reason instead of red, and the web client's type carries the field.

The field is **optional**, on purpose: `CoverageReport` is public API for the web client, the VS
Code extension and MCP, so a required field would break every external constructor — and an older
`--json` report deserialized against the new type still satisfies it.

**Verification.** 9 new tests. The one that matters most asserts the number did not move: an
operation with both an asserting and a silent request is still 100% covered and raises no
complaint, in either array order — this is a better explanation of the same figure, not a new
figure. Plus a stable sort (the report is diffable), a missing-`filePath` case, and a CLI test
feeding it a report with no `unasserted` at all. 837 unit tests, 97 e2e, 19 VS Code tests, coverage
95.72% lines / 87.77% branches / 96.62% functions, typecheck 8/8, dogfood gates clean.

**Also probed and cleared.** Drift correctly reports a renamed path parameter (`{id}` -> `{petId}`)
as one stale and one untracked operation. Noisy for a rename, but not wrong — they are genuinely
different operation keys, and silently pairing them up would hide a real spec change.

### 42 — a proxy with no way out, found by a harness that could not reach its own server

**What I set out to do.** Verify `codegen`. Seventeen targets is a lot of surface, and a snippet
that doesn't send what the engine sends is the classic defect there. Syntax-checking is not enough,
so I built a differential harness: an echo server, a request loaded with everything that stresses
escaping (a header holding `he said "hi" and \ that`, query values `a&b=c d` and `it's`, a JSON
body with `Say "hello"`, `C:\temp\x`, `$100 \`tick\``, and `héllo → 世界`), then run the engine
and each snippet against it and compare what actually arrived.

**Codegen came back clean**, which is worth recording as a result rather than a non-event. Across
curl, wget, python-requests, ruby, php and JS: method, path, both query parameters, the
backslash-and-quote header and every body value arrive byte-identical to the engine. The only
differences are that snippets pretty-print their JSON (semantically identical, and nicer to read in
a snippet), python's `json.dumps` escapes non-ASCII by default, and undici adds `accept-language`
and `sec-fetch-mode` of its own that no other client sends. `javascript-fetch` is byte-identical.

**The bug was in the harness's own failure.** The engine could not reach the echo server on
`127.0.0.1`, even with `NO_PROXY=127.0.0.1` set. That was not a harness problem:
`transportFromEnv` reads `HTTPS_PROXY`/`HTTP_PROXY` — added in iteration 26 — and **never reads
`NO_PROXY`**. Once a proxy is in the environment, every request goes through it, including
localhost, with no way to opt out. Proven both directions: with the proxy set and `NO_PROXY` set
the local server is never reached; with the proxy variables removed it is.

That is a developer behind a corporate proxy being unable to run TruSpec against their own dev
server, using the escape hatch curl, wget, git, Go and Python all honour. It also explains a `405`
I had written off as a sandbox artifact several iterations ago.

**Change.** `NO_PROXY`/`no_proxy`/`TRUSPEC_NO_PROXY` are honoured, and `--no-proxy` added to `run`
and `serve` alongside `--proxy`. The dispatcher choice moved from once-per-run to **per request**,
because that is what the feature means: the dev server on localhost goes direct while everything
else still goes through the proxy. Matching follows the curl/wget convention — `*` bypasses
everything, an entry may be a host, a `.suffix` or a `host:port`, and a bare suffix matches on a
label boundary.

**A bug in my own first implementation.** Detecting a pinned port as "text after the last colon"
is wrong for IPv6: `::1` parses as host `:` on port `1`, so the entry silently never matches. The
test I wrote for bracketed IPv6 caught it before the commit; only a bracketed address or a
single-colon name carries a port.

**Verification.** 9 new tests covering the label-boundary case (`example.com` must not bypass
`notexample.com`), `*`, pinned and default ports, case and whitespace, a malformed URL, IPv6 in
both forms, and the three environment variables. Then end to end against a real local server:
`NO_PROXY`, `--no-proxy 127.0.0.1` and `--no-proxy '*'` all reach it, and with no bypass the
request still goes to the proxy — the proxy itself still works. 846 unit tests, 97 e2e, coverage
95.75% lines / 87.68% branches / 96.64% functions, typecheck 8/8, dogfood gates clean.

### 43 — exporting to Postman handed over requests that tested nothing

**Gap.** A round-trip is the sharpest test an importer/exporter pair can face, so I built one:
export `examples/blog` to Postman, import it straight back, and compare every field of every
request against the original.

Three requests survived. Every **assertion** did not, and neither did any **spec link** — and the
export said nothing about either.

That is the whole value proposition leaving the building. A TruSpec collection's assertions are why
it can gate CI; exporting one to Postman produced a set of requests that check nothing, handed to a
colleague who has no way to know something was removed. The exporter already emits Postman `event`
blocks for a JS `script.post`, so it was exporting the *escape hatch* while dropping the declarative
assertions the format is built around.

**Change.** Assertions are rendered as a Postman test script. `status`, `header`, `body` and
`duration` map directly onto `pm.expect`; a `jsonpath` maps when it is simple enough for the lodash
`_.get` that Postman ships (`$.data.items[0].id` yes, a filter or `..` descent no). Tests are named
the way TruSpec names the assertion, so a Postman failure reads the same as a TruSpec one.
Assertions run before an existing `script.post`, matching the order TruSpec uses.

**What is deliberately not mapped, and now says so.** A `schema` assertion needs the OpenAPI spec,
which a Postman collection does not carry. A `jsonpath` with a filter or wildcard has no lodash
equivalent — and a silently *wrong* assertion in someone's Postman run is worse than an absent one,
so the path is named in `warnings` instead. The `spec` link has no Postman home either and now
warns rather than vanishing. Nothing is dropped in silence any more.

**Verification.** 11 tests. Two carry weight beyond the mapping table: one feeds a value chosen to
break out of the generated JavaScript (`");alert(1);//`) and asserts it stays inert data, and one
renders every assertion form at once and compiles the result with `new Function`, which is a real
syntax check — a generated script that does not parse would otherwise surface only when someone
pressed Send in Postman. 857 unit tests, 97 e2e, coverage 95.77% lines / 87.73% branches / 96.71%
functions, typecheck 8/8, dogfood gates clean. The exporter was also undocumented; `docs/importing.md`
now covers it, including exactly what does not survive the trip.

**Left for its own iteration.** The importer still turns Postman test scripts into commented-out
`script.post`, so importing a real Postman collection yields requests with zero assertions — the
same "tests nothing" shape, in the other direction. Recognising the common `pm.test` patterns and
converting them back into declarative assertions is a larger piece of work and deserves its own
pass rather than being bolted onto this one.

### 44 — importing from Postman produced a collection that checked nothing

**Gap.** The other half of iteration 43. Every Postman `test` script became a commented-out
`script.post`, so importing a real Postman collection produced requests with **zero assertions**: it
ran without checking anything and reported 0% coverage. For a product whose pitch to a Postman user
is "bring your collection", that is the worst possible first impression — the import appears to
succeed, and quietly hands back something that tests nothing.

**Change.** A recogniser for the Postman test idioms that actually occur: `pm.response.to.have.status(200)`
(the most-pasted test script in existence), `pm.expect(pm.response.code)` in its `eql`/`equal`/
`oneOf`/`below`/`at.least` spellings, `responseTime`, header existence and equality/negation,
`pm.response.text()` inclusion, and a JSON value reached either by accessor chain (`jsonData.data.id`)
or by `_.get`. Single-quoted strings are handled, because they are valid JS and invalid JSON.

**The rule that keeps it honest.** Anything unrecognised marks the script incomplete, the ported
comment is kept, and a human still sees the original — a guessed assertion is worse than an honest
gap. Only when *every* non-structural line was understood is the comment dropped, because a
commented copy of a script whose meaning now lives in `assertions` is noise. A `const jsonData =
pm.response.json()` line carries no assertion and correctly counts as structural rather than as a
leftover.

**Verification.** 11 recogniser tests written against hand-written Postman styles rather than only
the shape this project's own exporter emits — that distinction is the point, since the feature
exists for *other people's* collections. Two of them assert the negative: a script with a `reduce`
over the body recovers the one status check it contains and still reports incomplete, and a script
that only sets an environment variable recovers nothing and claims nothing.

Then the property that ties both iterations together, now a committed test: export `examples/blog`
to Postman, import it straight back, and every assertion is identical — with a guard that the
fixture really does carry assertions, so it cannot pass by comparing two empty lists. Method, URL
and body round-trip too. The only thing that still does not survive is the `spec` link, which has
no Postman representation and says so in `warnings`.

872 unit tests, 97 e2e, coverage 95.76% lines / 87.42% branches / 96.18% functions, typecheck 8/8,
dogfood gates clean.

### 45 — a contract report that contradicted itself

**Gap.** `contract` is the deepest spec-sync feature, so I probed it the way I probed the mock:
nine responses against a spec with a required-property schema. The validator itself is very good —
`/name: missing required property 'name'`, `/id: expected integer, got string`, null and array
mismatches, non-JSON bodies, all caught with precise, actionable messages.

The **report** was not. Point it at an API returning 500 and it printed:

    Contract: 0/1 tested operations conform to the spec

    Skipped — spec declares no schema for the response status (1):
      ~ GET /pets/{id}

    All 1 tested operation(s) conform to the spec.

The header says nothing conformed. The footer says everything did. Both in the same output, and the
reassuring one is false — nothing was validated at all. A reader scanning CI sees the last line.

**What I deliberately did not change.** `contract` exits non-zero only on a schema violation, and
`docs/spec-sync.md` states that explicitly: untested and status-undocumented operations are
reported but don't fail the gate, because that is `run`'s and `coverage`'s job. That is a
defensible split and a documented promise, so changing the exit code would break existing
pipelines. The bug is that the output lied about what the exit code meant.

**Change.** The summary never claims conformance that was not established: nothing validated says
so outright, a partial result reports as partial, and "all conform" is reserved for when they all
did. The "Skipped" section became "Not validated", and each line now says *which* of the two
reasons applies — because "the request failed (500) — see `truspec run`" and "the spec declares no
schema for the response status" are different problems with different fixes, and reporting both as
a bare skip hid the first one completely. The same distinction iteration 41 drew for `coverage`.

**Verification.** 5 new tests over the summary logic, one per branch, plus the negative that
matters: with nothing validated the output must not match `/All \d+ tested operation/` at all.
Confirmed end to end against a live server for each case — conforming, schema violation, failed
request, and a genuinely undocumented status where the request itself succeeded (that last one is
what distinguishes the two skip reasons, and my first attempt at testing it was wrong: a 204
against `status equals 200` is a *failed* request, not an undocumented-status skip). 877 unit
tests, 97 e2e, coverage 95.70% lines / 87.41% branches / 96.18% functions, typecheck 8/8, dogfood
gates clean.

### 46 — a data-driven run could only ever send strings

**Gap.** Probed `--data` and `--repeat`, which no iteration had touched. Most of it is sound: CSV
quoting handles `"Comma, Name"`, JSON datasets work, `--repeat` is correctly ignored alongside
`--data`, an empty dataset fails rather than quietly becoming one variable-less run, and a row
missing a referenced column fails before the request is sent.

One thing was wrong, and it undercuts the feature's main use. A JSON dataset row `{"qty": 1}`
arrived at the server as `{"qty":"1"}`. `interpolateDeep` stringifies unconditionally, so **no
data-driven run could send a non-string JSON value at all**.

That collides with this project's own features: point `contract` at an API whose spec declares
`qty` as an `integer` and it reports `expected integer, got string` — a violation the collection
author has no way to fix. The format itself says types were meant to survive: an environment's
`variables` are `string | number | boolean` in the schema, and `capture` stores the JSON value it
read. Both are stringified the moment they reach a body.

**Change.** In a `json` body (and in `graphql` variables, where an `Int!` argument sent as a string
is rejected outright), a value that is **exactly one placeholder** now keeps the variable's type.
Anything with concatenation stays text, because concatenation is a string operation:
`qty: "{{qty}}"` sends `2`; `sku: "sku-{{qty}}"` sends `"sku-2"`.

**Scope, deliberately narrow.** URLs, headers, query parameters, `text` bodies and `form` fields
are untouched — those are string formats with nothing to preserve. And a CSV dataset still yields
strings, because CSV cells genuinely are text; guessing types out of CSV is how `007` becomes `7`
and a phone number gets mangled. Use a JSON dataset when the type matters, which the docs now say.

**This is a behaviour change, and worth stating plainly.** A collection with `"{{var}}"` in a JSON
body where the variable is a number or boolean now sends it typed rather than quoted. I judged the
old behaviour the bug rather than the contract — the schema and `capture` both preserve types, so
discarding them at the last step was the inconsistency — but anyone relying on the string form
would see a difference. The full suite passes unchanged, so nothing in the repo depended on it.

**Verification.** 13 tests: the type-preserving cases, the concatenation cases that must stay text,
whitespace inside the braces, a missing variable under both policies, the `Object.prototype` guard
(`{{toString}}` must be missing, not a function), nesting inside arrays, and — the one that bounds
the change — that the behaviour is **off by default**, so every other field still interpolates as
text. Plus end-to-end checks that a resolved request really puts `2` and not `"2"` on the wire.
890 unit tests, 97 e2e, coverage 95.71% lines / 87.44% branches / 96.18% functions, typecheck 8/8,
dogfood gates clean.

### 47 — what a script can actually reach, made visible

**Gap.** Probed the scripting sandbox. Error handling is genuinely good: a pre-script that throws,
references an undefined name, or fails to parse each fails the request **without sending it**, with
the real message (`Pre-request script error: boom in pre`). A failing `tr.expect` in a post-script
lands as a normal assertion failure. Nothing to fix there.

The interesting part is the isolation. The obvious globals are absent — inside a script, `process`,
`require` and `fetch` are all `undefined`, and the context's own
`Function("return typeof process")()` correctly answers `undefined`. But every object handed into
the context is a bridge out of it: `tr.constructor.constructor("return typeof process")()` returns
`object`. That is the host realm. A script therefore has the same access as the `truspec` process
itself — every environment variable, every resolved secret, every file the user can read or write.

**This is documented, and I did not treat it as a hidden bug.** `docs/scripting.md` and `CLAUDE.md`
both say a `vm` context is not a security boundary; Node's own documentation says the same. I
deliberately did **not** try to harden it: `vm` is not a sandbox, a partial fix that blocks the one
probe I happened to write would create false confidence, and claiming a sandbox I cannot deliver
would be worse than the honest warning that exists.

**What was missing was visibility, at the moment it matters.** The trust model assumes you wrote
the collection. This product's headline features include importing Postman, Bruno, Insomnia and HAR
collections — files you were handed, downloaded, or generated. Nobody opens every file after an
import, and nothing told them a `script:` block was in there.

**Change.** A twelfth lint rule, `script-runs-unsandboxed`: a warning on every request carrying a
script, naming which (`script.pre`, `script.post`, or both) and why it matters. `truspec lint` on a
freshly imported collection now lists exactly what to read before running it — an invisible risk
turned into a reviewable line, using the machinery this project already has for secrets and dead
assertions.

The docs were also vaguer than the facts. "Not a security sandbox" is true but abstract; it now
states concretely that the obvious globals are absent, that a script can still reach the host realm
through an object passed into the context, and precisely what that grants — and that the ~1s
timeout bounds a runaway loop, not access.

**Verification.** 4 tests: each of the three script shapes named correctly, silence for a request
with no script, the rule disable-able like any other, and its presence in `LINT_RULES` so
`--list-rules` and the docs cannot drift. 894 unit tests, 97 e2e, coverage 95.71% lines / 87.44%
branches / 96.18% functions, typecheck 8/8. The examples still pass `lint --strict` (the new rule
would have broken that gate had any example carried a script — checked deliberately, since
`--strict` fails on warnings).

### 48 — one unpaginated endpoint locked the browser tab

**Gap.** The response viewer had no notion of size. `prettyBody` parses and re-stringifies the whole
body, and `JsonBlock` syntax-highlights it by emitting **one `<span>` per token**. Nothing anywhere
bounded either.

Measured, in a real browser, on a 1.16MB JSON list — an entirely ordinary response from an endpoint
that forgot to paginate:

    1.16MB body -> 480,002 DOM spans, 7,627ms to render, 747ms per click afterwards

Seven and a half seconds of frozen tab, and a page that stayed sluggish after. A 6MB body would be
~2.4 million spans; I did not measure that one because the point was already made.

**Change.** Two bounds, both with the same rule attached: never present part of a body as if it
were all of it.

- Past **256KB** the body renders as plain text instead of highlighted. Colour is a nicety; a
  responsive page is not. The whole body is still shown, still filterable, still copyable.
- Past **2MB** only the first slice goes into the DOM, and a `role="status"` notice states both
  numbers — "showing the first 2048KB of 3536KB" — and points at save/copy for the rest.
  Pretty-printing is also skipped there, since it inflates the text ~1.5x before anything is drawn.

**Result on the same measurement:** 1,185ms and **0 spans**, from 7,627ms and 480,002 — about 6.4x
faster to render, with the DOM explosion gone rather than reduced.

**Verification.** 4 e2e tests, all written against a real browser and a real server rather than a
mock: the render-time and interactivity bound (with the span count asserted, since that is the
mechanism), the notice on a large-but-whole body, the truncation notice with both figures on a
~3.5MB body, and — the one that bounds the change — that an ordinary response is still highlighted
and carries no notice at all. That last test matters most: a performance fix that quietly degrades
the common case is not a fix. 894 unit tests, **101 e2e**, coverage 95.71% lines / 87.44% branches
/ 96.18% functions, typecheck 8/8, dogfood gates clean.

### 49 — importing a HAR gave you the asset pipeline

**Gap.** A HAR is "Save all as HAR" from the browser's Network panel, which the docs correctly call
the fastest way to turn what an app actually did into a collection. The importer already skips
`OPTIONS` preflights by default, on the stated grounds that they are "transport, not API surface".
Static assets are the same category and vastly more numerous, and nothing skipped them.

Measured on a realistic single page load — document, stylesheet, two script chunks, an SVG, a PNG,
a favicon, a webfont, an analytics beacon, four API calls, one preflight:

    13 files written, of which 4 were API calls

**69% noise**, and that is a deliberately small fixture; a real SPA HAR carries hundreds of asset
entries. Every one becomes a `.tspec.yaml` that `truspec lint` then flags for having no assertions.
You cannot use the result without pruning it by hand first.

**Change.** Static assets are skipped by default — documents, styles, scripts, images, fonts, media
— with the count reported the way the `OPTIONS` skip already is, and `--include-assets` /
`includeAssets` to keep them. Same fixture: 13 files became 5.

**Two decisions worth stating.** The judgement uses the HAR's **recorded response content type**,
never the URL: an API route ending in `.json` is not an asset, and a path like `/avatar` may well
be one. And an entry whose type the HAR never recorded is **kept** — absence of evidence is not
evidence.

**The honest cost.** Response-type filtering genuinely cannot distinguish your avatar endpoint from
the page's logo. An API that serves images or PDFs loses those entries by default. That is not
hidden: it has a test of its own asserting the drop happens, the counted warning names it every
time, and the docs say plainly that nothing can tell them apart for you — which is what the flag is
for. The analytics beacon in the fixture is correctly *kept*, because a `text/plain` POST is a real
request the app made, not an asset; filtering by host would have been overreach.

**Verification.** 6 tests: every asset family, the un-recorded type, the URL-that-looks-like-an-asset
case, `includeAssets` restoring everything, the avatar case stated rather than hidden, and assets
counted separately from preflights. 900 unit tests, 101 e2e, coverage 95.72% lines / 87.45%
branches / 96.19% functions, typecheck 8/8, dogfood gates clean. (The doc note first landed inside
a fenced code block — caught by checking the fences balance, and moved out.)

### 50 — the hard rule the linter only half enforced

**Gap.** CLAUDE.md states it as a hard rule: *"Never inline secrets into request or environment
files."* Probing `env` first cleared the obvious worry — `truspec env <name>` prints
`resolved from the environment`, never a value, in both human and `--json` output, and `env --diff`
compares names. Nothing leaks there.

The linter is where the rule broke down, in two independent ways.

**It never read environment files at all.** `lintWorkspace` walks `discoverRequests(dir)`. An
`environments/leaky.env.yaml` carrying an inlined Stripe key *and* an AWS access key id linted
completely clean. An environment file is precisely where someone puts the value a `{{var}}` needs —
the rule names them for a reason, and the tool enforced it only for requests.

**Its patterns were anchored to the whole value.** `^(sk|rk|pk)_(live|test)_…$` matches a bare key
and nothing else, so `Authorization: "Bearer sk_live_…"` — the single likeliest shape for a real key
to get committed in — did not match. Verified directly before changing anything: anchored says
`false` for the `Bearer` form, unanchored says `true`.

**Change.** The patterns now search *within* a value, and `environments/*.env.yaml` are scanned,
with a message pointing at the actual fix (`declare it under secrets:` — a name, no value). Both
gaps on the same fixture now report: `headers.Authorization looks like a Stripe-style key`, and two
findings in the env file.

**Keeping it narrow, which is the whole risk here.** The rule's own comment says a linter that
cries wolf gets muted, and then it catches nothing — so un-anchoring had to not cost precision. A
`(?<![A-Za-z0-9_-])` lookbehind keeps a match from firing inside a longer opaque token, and the
prefixes were already distinctive. Tested against URLs, UUIDs, prose, content-type headers and
ISO-8601 ranges, none of which fire; `password: "hunter2-not-really-but-still"` is still correctly
ignored, because it matches no high-confidence pattern and guessing would be worse than silence.

**Verification.** 8 tests: the three embedded-credential shapes, five ordinary long strings that
must stay silent, the lookbehind guard, templates still treated as templates, env-file detection
with both keys and the right path, a clean environment staying clean, and an unparseable env file
reported rather than skipped. 907 unit tests, 101 e2e, coverage 95.72% lines / 87.45% branches /
96.19% functions, typecheck 8/8. The examples still pass `lint --strict`, which matters more than
usual here: a new *error*-severity path over files never linted before would have broken that gate
outright if it were over-eager.

### 51 — a 302 that was really "I gave up"

**Gap.** Probed the runner's redirect and retry behaviour against two real loopback origins. Almost
all of it is right, and the most important part is right for the right reason:

- Redirects are **off by default**; a 3xx is returned as-is and stays assertable.
- On a **cross-origin** redirect the credentials are dropped — the second origin received
  `auth: null, cookie: null`. That is the security property the PR claimed, now verified against a
  real second server rather than taken on trust.
- `maxRedirects` caps the chain (1 + N requests, exactly), retries re-send on a 5xx and stop as
  soon as it recovers, and a same-origin hop keeps its credentials.

The gap is in the report. When the chain stops, the result is the last response — and a bare `302`
in a run report reads as *the server's answer*, when it may be the third one and the client is the
thing that stopped. Nothing distinguished "the server stopped redirecting" from "we hit the cap".

The chain was already being recorded: `redirects` is on the result and visible in `--json`. It was
simply invisible in the format people actually read, and carried no reason.

**Change.** `sendRequest` now reports *why* it stopped, and the human output shows the chain:

    ✗ FAIL  R  (api/r.tspec.yaml)  302 26ms
          ↪ followed 1 redirect(s) — stopped at maxRedirects: http://127.0.0.1:4000/step1

versus a chain that ended on its own:

    ✓ PASS  R  (api/r.tspec.yaml)  200 30ms
          ↪ followed 2 redirect(s): http://…/step1 → http://…/step2

**One distinction worth being careful about.** With `followRedirects` off, `maxRedirects` is 0, so
`hop >= maxRedirects` is true on the very first response — but "we never follow" is not "we gave
up". That case must not be labelled a limit, and there is a test for exactly it.

**Verification.** 5 tests: the cap flagged and the natural end not flagged (driven through a real
server that redirects twice then succeeds), the following-disabled case, and three over the output
— hop count, the `stopped at maxRedirects` suffix, and silence when no redirect was followed.
912 unit tests, 101 e2e, coverage 95.72% lines / 87.45% branches / 96.19% functions, typecheck 8/8,
dogfood gates clean.

### 52 — the third file type nobody linted

**Gap.** Probed folder inheritance across three nesting levels, and the semantics are exactly
right: headers merge with deepest-wins-per-key, root headers survive three levels down, a folder's
`auth` replaces at the nearest declaring level, and a request's own header and auth beat every
folder. Verified against a real server by reading what each request actually sent. No change needed
there.

Two things around it were not right, and they are the same shape as iteration 50.

**`lint` never read `folder.tspec.yaml` at all.** A folder config carrying an inlined AWS key in a
header *and* a live Stripe key in `auth.token` linted completely clean, exit 0. This is the worst
instance of the class rather than a third equal one: a folder's `auth` applies to **every request
beneath it**, which makes it the most attractive place to paste a real token and the most damaging
place for one to sit committed. The format defines three file types; the secret rule read one, then
two after iteration 50, and now all three.

**A broken folder config named no file.** `run` correctly aborts — a bad config silently dropping
`baseUrl` and `auth` for everything beneath it would be far worse — and the message even carries
iteration 27's `did you mean 'headers'?`. But it said only *"Invalid TruSpec folder config"*, and a
workspace has many. It now leads with the path: `v1/folder.tspec.yaml: Invalid TruSpec folder
config: …`. `lint` reports the same thing before a push rather than at run time.

**Change.** Folder configs are linted for parse errors and inlined credentials, and the runtime
error names the file. The auth-field walk is now shared between requests and folder configs instead
of duplicated, since it is the same list of credential-bearing fields.

**Verification.** 4 tests: both credentials found with the right path and the "every request
beneath it" wording, an unparseable folder config reported as a `parse` error, a well-formed one
staying silent (templates are not literals), and the runtime error asserting both the path prefix
and that the existing suggestion survives. 916 unit tests, 101 e2e, coverage 95.73% lines / 87.47%
branches / 96.22% functions, typecheck 8/8. The examples still pass `lint --strict` — again the
gate that matters, since this adds an error-severity path over files never linted before.

### 53 — `gen` produced a collection that `drift` immediately rejected

**Gap.** Scaffolded a realistic shop spec with `truspec gen`, then ran `truspec drift` against the
very spec it came from:

    Changed (2):
      ~ GET /products: missing required query param 'limit'
      ~ POST /products: missing required request body

    Drift detected: 0 untracked, 0 stale, 2 changed.   exit 1

The tool's own two commands contradicted each other. `gen` is the on-ramp for spec-first users —
scaffold from your OpenAPI, then gate CI on `drift` — and doing exactly that failed on the first
try, with the user having done nothing wrong. `drift` even named precisely what was missing; `gen`
simply never emitted it. Path parameters were handled; required **query** parameters and required
**bodies** were not.

**Change.** A scaffolded request now carries what the spec says the operation cannot work without:
every required query parameter (optional ones deliberately left out — scaffolding them all buries
the request in noise), and a JSON body when the operation requires one, generated by the same
`generateExample` schema walk the mock server uses, so the scaffold and the mock agree on what the
spec describes. That needed the request-body schema and the parsed document on the spec summary,
both of which were being discarded.

**Concrete samples, not templates, for query parameters.** Path parameters stay `{{variables}}`
because an id genuinely varies per environment; a `limit` or a page size is a constant, and a
concrete value makes the collection runnable the moment it is generated rather than after declaring
variables that were never really variables.

**Verification.** The invariant is now a committed test rather than a one-off check: **what `gen`
produces satisfies `drift` against the spec it came from** — asserted over both real example specs
(petstore and blog) and over a synthetic spec carrying exactly the two cases that were broken. Plus
two boundary tests: the required query parameter is emitted and the optional one is not, and an
operation whose body is `required: false` still gets no body. The same end-to-end check that failed
with exit 1 now reports `No drift — collection matches the spec.` 921 unit tests, 101 e2e, coverage
95.75% lines / 87.47% branches / 96.23% functions, typecheck 8/8, dogfood gates clean.

### 54 — the three-way check, and a probe that cleared

**What I looked for.** Iteration 53 found `gen` and `drift` contradicting each other. That suggested
a sharper question: three components read the same OpenAPI document — the **scaffolder** deciding
what to send, the **mock's request validator** deciding what is acceptable, and the **runner** in
between. Do all three agree?

**They do.** `gen` → `mock --validate` → `run` comes back 2 passed, exit 0, and
`gen` → `mock` → `contract` reports 3/3 operations conforming. No defect to fix; the probe cleared.

**Why it is still worth an iteration.** This is the first thing a spec-first user does — scaffold
from OpenAPI, point it at a mock, run — and until iteration 53 it did not work. Proven, not
asserted: strip exactly the required query parameter and required body the scaffolder now emits,
and the validating mock answers **400 to both**. That is the failure the previous iteration fixed,
reproduced deliberately, which is what makes the passing case mean something.

So the invariant is now committed rather than a one-off command I happened to run: two tests, the
positive and the negative that proves the mock is really checking. Without the second, the first
could pass against a mock that validates nothing — the same "test asserts the bug" trap iteration
39 found in `mock.test.ts` and iteration 41 nearly walked into.

Written against the library APIs rather than by spawning the CLI, so it costs 141ms and needs no
processes.

**Verification.** 923 unit tests, 101 e2e, coverage 95.77% lines / 87.57% branches / 96.23%
functions, typecheck 8/8, dogfood gates clean.

### 55 — the agent surface answered questions about places it never looked

**What I looked for.** "Agent-native by design" is the strategy, and the MCP server is the whole of
that surface — 23 tools, mostly untouched by this campaign. So I stopped reading it and used it:
connected a real MCP client and called every tool the way an agent actually would, with arguments
that are *plausible but wrong*. Not fuzzing — the mistakes a model makes: a mistyped directory, a
spec path that doesn't exist, the wrong paragraph pasted into an importer.

Two defects, one theme.

**`truspec_import_curl` fabricated a request from prose.** Given the string `not a curl command`, it
wrote a file:

```yaml
name: GET command
method: GET
url: command
```

No warning, no error, exit 0. The importer takes the first non-flag token after `curl` as the URL,
so any sentence containing the word produces a request whose URL is the next word. That file
validates against the schema, gets committed, and can never run — `fetch("command")` is not a
request. The failure mode is precisely the one an agent hits: it is handed a paragraph of prose
that mentions curl, and gets a plausible-looking artifact back instead of "that isn't a curl
command".

Fixed by requiring the URL to be capable of being one — a scheme, a `{{template}}`, an absolute
path, or a host-shaped authority (a dot, a port, or `localhost`), which is the same set curl itself
accepts. Anything else is skipped with a warning that names the token. The CLI now writes nothing
and exits 1; before it wrote the file and exited 0.

**Five tools reported a clean bill of health for directories that were not there.**

```
lint  {dir: "nope"} -> {"files":0,"findings":[],"errors":0,"warnings":0,"ok":true}
docs  {dir: "nope"} -> {"count":0,"markdown":"# nope\n\n0 requests..."}
list_collections    -> {"count":0,"requests":[]}
environments        -> {"environments":[],"errors":[]}
coverage / drift / contract -> reports about a collection that does not exist
```

`ok: true` is the dangerous one. An agent told to lint before committing reads that as permission,
having checked nothing — the same shape as iteration 40, where `run --grep` selected zero requests
on Windows and exited 0. The CLI already gets this right: `truspec lint no-such-dir` prints
`Path not found` and exits 1. The agent surface, which has *less* ability to notice something looks
off, was the lenient one.

`requireDir` now refuses a missing path by name across all seven tools, and distinguishes
`Not a directory: a.txt` from `Directory not found: nope`. Throwing rather than returning an error
object, so it matches how `truspec_run_request` already reports a bad path and keeps every tool's
return type honest.

**Judgement call.** The same probe showed `truspec_run_request` will happily read a path outside the
workspace (`../../../etc/hosts`), while every write tool confines. That is a real inconsistency, but
it is a boundary change across seven call sites and deserves its own iteration rather than a
footnote in this one.

**Verification.** 932 unit tests (9 new), coverage 95.81% lines / 87.63% branches / 96.24%
functions, typecheck 8/8, `lint examples --strict` clean, JSON Schema unchanged.

### 56 — the workspace boundary that half the agent surface enforced

**The inconsistency iteration 55 flagged.** Every write tool confines its path to the directory the
MCP server was launched in — `create`, `update`, `delete`, `scaffold`'s output, every importer's
output. Reading, running, and every spec path did not: they resolved against `cwd` and went
wherever they were pointed.

```
truspec_run_request   {path: "../../../etc/hosts"}   -> read it, reported it by absolute path
truspec_run_collection {dir: "/"}                    -> walks the entire filesystem, and sends
                                                        every .tspec.yaml found anywhere on it
```

The second is the one that matters. `run` is the side-effecting tool: it makes network requests,
resolves secrets out of the environment into them, and hands the responses back to the model. A
request file the user never wrote, sitting anywhere on the machine, was reachable.

**What I checked before fixing.** Whether a pre-request script from such a file could reach the
filesystem — it cannot; the vm context exposes only `tr`, and `require` is undefined there. So the
exposure is "sends requests the user did not author and reports what came back", not arbitrary
code execution. Worth fixing, and worth stating accurately.

**The rule, now uniform:** every path an MCP tool acts on is confined to the workspace, because
every one of them comes from a model rather than from a person at a shell — the same boundary
`confinePath` has always drawn for writes, extended to the other half.

**The cost, and why I took it.** This does break one real layout: a monorepo whose collection and
OpenAPI spec live in different packages, addressed as `../shared/openapi.yaml`. The answer is to
launch the server at the repo root, which is where the workspace root already resolves to. I chose
the rule that can be stated in one sentence over a per-argument split (writes confined, specs not)
that nobody could predict — and the refusal names itself: `Path escapes the workspace: <path>`, so
an agent that hits it learns the boundary at the moment it matters. Documented in `docs/mcp.md`,
including the monorepo escape hatch.

One existing test had to change: it scaffolded from `examples/petstore/openapi.yaml` into a temp
cwd — an artifact of the test setup rather than a user pattern. The spec now lives in the workspace
under test, which is also a more honest fixture.

**Verification.** 936 unit tests (4 new pinning the boundary, including one proving what is
*inside* still runs), coverage 95.85% lines / 87.64% branches / 96.47% functions, typecheck 8/8,
docs site builds.

### 57 — the lost update at the centre of the pitch

**What I looked for.** The claim this product rests on is that the files in your repo are the
source of truth and *more than one thing writes to them* — you in the UI, an agent through the MCP
server, `git pull`, your own editor. Nothing in this campaign had tested what happens when two of
those touch the same file at once.

**What happens.** Open a request in the web UI, edit a field, and while it is open let something
else append to that file. Hit save:

```
--- file after save ---
tspec: "0.1"
name: Get pet
method: POST                      <- my edit, saved
url: "{{baseUrl}}/pets/1"
...                               <- the other edit: gone
external edit survived: false
any warning shown: 0
```

A textbook lost update, with no warning, in the one workflow the product exists to support. The
web server had no notion of the file's version at all: `GET /api/request` handed over content,
`POST /api/request` wrote whatever came back, and everything in between was discarded.

**The fix.** `GET /api/request` now returns a `version` — a truncated sha256 of the exact bytes,
content rather than mtime, because a `git checkout` that restores a file byte-for-byte is not a
conflict. The client sends it back as `baseVersion`; if the file on disk no longer matches, the
save is refused and the current content comes back with the refusal. A save with no `baseVersion`
writes as before, so nothing else that talks to this API changes behaviour.

The UI then offers the choice that actually exists — **reload from disk** (take theirs, drop your
draft) or **overwrite** (take yours) — rather than a warning the user can only click through.
Cancel leaves the tab exactly as it was, which matters: the user may want to copy something out of
their draft before deciding.

**One thing this shook out.** The version rides along on the request detail, and the request schema
is `.strict()` — so a draft carrying `version` would have been rejected by name on the next save.
There were four places stripping the client-only `raw` field by destructuring, each of which would
have needed a second field added, and a fifth added later would have missed it. Replaced with one
`requestFields(detail)` helper the four call sites share.

**Verification.** 940 unit tests and 105 e2e (4 new e2e covering refuse / reload / overwrite / an
ordinary save unaffected, 4 new server tests including one proving a save without a version still
writes), typecheck 8/8, docs site builds.

### 58 — the response body, decoded the way the response said to

**What I looked for.** Everything so far has tested requests the runner sends. This time: responses
real servers send that are not tidy UTF-8 JSON. I stood up a server returning a latin-1 body, a
JSON body with a UTF-8 BOM, a PNG and an octet-stream, and looked at what came back.

**Two defects, one function.** `readResponseText` ended in `buf.toString("utf8")`, unconditionally.

*A declared charset was ignored.* A server saying `content-type: text/plain; charset=iso-8859-1`
— legacy APIs still do — had every accented byte replaced with U+FFFD:

```
caf� na�ve r�sum�          (what TruSpec saw)
café naïve résumé          (what the server sent)
```

So `body contains "café"` could not match a body that plainly contained it, and the response
viewer showed mojibake.

*A UTF-8 BOM broke every jsonpath assertion.* .NET and PHP stacks emit one routinely. `JSON.parse`
throws on a leading U+FEFF, so `json` stayed undefined and the run reported:

```
✗ FAIL  bom  (api/r.tspec.yaml)  200 24ms
      ✗ jsonpath $.id → (no match) fails == 7
```

A 200, a body that reads correctly in every viewer (the BOM is invisible), and an assertion that
says "no match" with nothing to explain it. This is the kind of thing someone spends an afternoon
on and then leaves the tool over.

**The fix.** `decodeResponseBody(buf, contentType)` honours an explicit charset via `TextDecoder`,
defaults to UTF-8 when none is declared (HTTP's historical latin-1 default would corrupt every
modern JSON API), falls back to UTF-8 for a charset label nothing recognises rather than failing
the request, and strips a leading BOM — an encoding marker, not content.

**Deliberately left for the next iteration.** A binary body (`image/png`, `application/octet-stream`)
is still decoded as text and comes back as replacement characters — lossy, so the web UI's download
of a binary response cannot produce the real bytes. That needs the response to carry the bytes, not
just a string, which is a wider change than this one and gets its own iteration rather than being
smuggled into it.

**Verification.** 946 unit tests (6 new: 4 pure decoder cases, 2 through a real server), coverage
95.83% lines / 87.66% branches / 96.28% functions, typecheck 8/8, `lint examples --strict` clean.

### 59 — a PNG shown as mojibake, and saved as a file that will not open

**The half iteration 58 deferred.** A binary body — `image/png`, `application/pdf`,
`application/octet-stream` — was decoded as UTF-8 like everything else and passed on as a string:
what came back for a PNG was `<U+FFFD>PNG\r\n...IHDR...`, with every byte that is not valid UTF-8
replaced.

That string is what the response viewer printed, and what ⇩ save wrote to disk. The bytes are gone
by then — invalid sequences became U+FFFD on the way in — so a saved PNG was not a PNG. The header
also read `130b`, which was the character count of the mangled string rather than the 131 bytes
that actually arrived.

**Detected by content, not by label.** Plenty of servers send JSON as `application/octet-stream`
and PDFs as `text/plain`; the content type is the least reliable thing in the response. A body is
binary when its decode produced replacement characters or NULs — which is exactly the condition
under which `bodyText` stopped being trustworthy.

**What each surface does now.**

- The runner reports `binary`, `bytes` (as they arrived), and `bodyBase64` for a binary body up to
  8MB — without the bytes, every client can only offer to save the mangled decode.
- The web UI shows what arrived (`image/png · 131 bytes`) instead of the mojibake, previews an
  image inline on a checkerboard so a transparent PNG isn't invisible, and saves the real bytes
  with a real extension (`png.png`, not `png.txt`).
- The HTML report prints `<binary response, 131 bytes>` rather than a screenful of garbage in the
  one artifact a reviewer opens to understand a failure.
- The byte counter reports bytes. `"café"` is 4 characters and 5 bytes; it said 4.

`bodyText` keeps its lossy value rather than being blanked: text assertions see exactly what they
saw before, so nothing silently changes meaning for an existing collection.

**Verification.** 949 unit tests and 108 e2e. The e2e is the one that matters: it captures the
Blob the save button builds and asserts it is byte-for-byte the PNG the server sent, and reads
`naturalWidth`/`naturalHeight` off the rendered preview — the browser decoding the image is proof
the bytes survived. Coverage 95.83% lines / 87.64% branches / 96.29% functions, typecheck 8/8.

### 60 — one user's token, handed to another

**What I looked for.** OAuth2 is the auth type most likely to be subtly wrong and the one that
blocks anyone testing a real API. The token cache added for rate-limit and cost reasons — twenty
requests under one folder block should fetch one token — is exactly the kind of optimisation that
is right until the key is wrong.

**The key was a hand-picked subset:** grant, token URL, clientId, username, scope, audience. Two
fields that decide which token comes back were missing.

```
A: refreshToken "user-a"        -> Bearer token-for-user-a   (cached: false)
B: refreshToken "user-b"        -> Bearer token-for-user-a   (cached: true)   token endpoint hits: 1

A: extra.resource "api-one"     -> Bearer token-for-api-one  (cached: false)
B: extra.resource "api-two"     -> Bearer token-for-api-one  (cached: true)   token endpoint hits: 1
```

Request B never asked for its own token. A per-user refresh token is the ordinary way to test a
multi-tenant API, and `extra` is where Azure AD's `resource` and every provider's tenant parameter
live. The visible symptom is a 401 with nothing in the collection to explain it. The invisible one
is worse: a request that asserts 200, gets it, and tested the wrong identity — a green CI gate
proving something about a user it wasn't asked about.

**The fix.** Key on the whole resolved token request — endpoint, client auth mode, client id and
secret, and every form field, sorted so two equivalent blocks agree. Hashed with sha256, because a
key built from the client secret and the password is a key that must never be printed.

Building the form moved above the cache lookup, which is also the more honest order: you cannot
know whether you have the right token cached until you know what you would have asked for.

**Verification.** Each of the three new cache-splitting tests fails against the previous key
(confirmed by reverting only the source: 3 failed, 20 passed) and passes with it, plus a fourth
holding the line that the cache still *works* — five identical resolutions, one token request.
953 unit tests, coverage 95.83% lines / 87.64% branches / 96.3% functions, typecheck 8/8.

### 61 — the session cookie the jar kept and never sent

**What I looked for.** The cookie jar has never been probed in this campaign, and cookie scoping is
where careful-looking code is usually wrong in one specific way. I ran eight scenarios through it
rather than reading it.

**The one that bites.** A `Secure` cookie set over `http://localhost` was stored and then never
sent:

```
Secure cookie set on http://localhost -> stored: ["sid"]
  sent back to http://localhost:        undefined
  127.0.0.1 variant:                    undefined
```

`http://localhost` is what a TruSpec collection points at all day, and Rails, Django and most
Express setups put `Secure` on the session cookie by default. So: log in, get a 200, and every
request after it is a 401 — with the cookie sitting in the jar, and nothing in the collection to
explain it. Browsers have treated loopback as a secure origin since 2020; the jar was checking
`protocol === "https:"`.

**Two more, from the same probe.**

`Domain=com` was accepted, storing a cookie against the whole `.com` suffix and sending it to
`api.com` afterwards. A run that talks to an auth server and an API is exactly the shape where one
host's cookie ends up on another's request. A single-label domain is now refused — the attribute
is dropped, not the cookie, so it stays host-only, which is what was meant.

`__Host-sid=1; Domain=test` was stored *and widened*, which is precisely what the name promises
cannot happen. The `__Host-` and `__Secure-` prefixes are now enforced (Secure required, `Domain`
forbidden, `Path=/` required): storing a cookie that breaks its own name is worse than ignoring
prefixes altogether.

**Not done: a public suffix list.** `Domain=co.uk` still slips through the single-label rule.
Closing that properly needs the PSL — a dependency that has to be shipped, updated and kept in
sync, for a case that requires an API testing run to hit two unrelated `.co.uk` hosts. The cheap
rule catches the realistic cases; the expensive one can wait for a reason.

**Verification.** Three of the five new tests fail against the old jar (confirmed by reverting only
the source: 3 failed, 20 passed) and the other two hold the lines that must not move — a Secure
cookie still withheld from plain http off-loopback, and widening to a real registrable domain still
allowed. 958 unit tests, coverage 95.86% lines / 87.73% branches / 96.31% functions, typecheck 8/8,
docs updated and building.

### 62 — the Bruno import that dropped the chain

**Why here.** Bruno is the closest competitor — local-first, files in your repo, the same
argument. Anyone who switches arrives through `truspec import bruno`, and what that import loses is
the first impression. So I wrote a realistic two-request Bruno collection (login → capture token →
authenticated call, with an assert block and a tests block) and imported it.

**What came out.** The `capture` was gone. Bruno's

```
vars:post-response {
  token: res.body.access_token
}
```

is exactly TruSpec's `capture:` — and it was dropped, with no warning. The login still ran, the
token was no longer saved, and the next request interpolated an undefined `{{token}}`. Chaining is
the reason a collection has more than one request in it; an importer that drops it produces
something that looks like a successful import and isn't.

Four more, from the same two files:

- `res.responseTime: lt 2000` was warned-about and skipped, though `{ type: duration, ltMs: 2000 }`
  is an exact equivalent. So were `neq`, `gt`, `lte`, `contains`, `matches`, `length`, every
  `is*` predicate, and every header assertion. The whole operator table is mapped now, and the
  test iterates it, so a missing one is a failing test rather than a warning nobody reads.
- `res.body.id: neq null` imported as the *string* `"null"` — an assertion that passes against a
  body whose field really is null, which is the case it was written to catch.
- `url: {{baseUrl}}/me?expand=profile` plus a `query { expand: profile }` block produced
  `?expand=profile&expand=profile`. Bruno shows those as one thing kept in sync; importing both
  duplicates every parameter, and plenty of APIs read a repeated parameter as an array.
- A `tests { }` block vanished silently. It cannot be converted — but it can be named.

**And one the tests found.** Writing the operator-table test surfaced that assert lines were being
collapsed into a `Map` keyed by the left-hand side. `res.status: gte 200` followed by
`res.status: lt 300` — an ordinary range check — kept only the second. Two constraints on one field
now both survive; `kvLines` stays a map for the blocks where a repeated key really is a conflict.

**Verification.** 964 unit tests (10 new), coverage 96.04% lines / 87.91% branches / 96.39%
functions, typecheck 8/8, docs updated and building. The first coverage run failed the functions
threshold at 95.11% — the operator table is a lot of small functions — which is the gate doing its
job: the table is now covered entry by entry rather than sampled.

### 63 — the same missing chain, in the format most people arrive from

**Straight after 62.** If the Bruno importer dropped the capture, what does the Postman one do? A
two-request collection — login with a test script, then an authenticated call — imported as:

```yaml
assertions: []
script:
  post: |
    // Ported from Postman — rewrite using TruSpec's tr API
    // pm.test("status is 200", function () { pm.response.to.have.status(200); });
    // const jsonData = pm.response.json();
    // pm.environment.set("token", jsonData.access_token);
```

Both halves lost. `pm.environment.set` is *the* Postman chaining idiom — it is how every collection
in existence passes a login's token to the requests after it — and it became a comment. And the
assertion was skipped too, because the whole `pm.test(…)` was written on one line: the structural
check treats a line starting with `pm.test(` as an opening brace with nothing in it, which is true
of the block form and false of the one-liner.

**Both fixed.** `pm.environment.set` / `collectionVariables.set` / `globals.set` / `variables.set`
convert to `capture`, reading the four shapes a value is written in — `jsonData.a.b`,
`pm.response.json().a.b`, `_.get(json, "a.b")`, `json["a"].b` — plus `pm.response.headers.get(…)`
and `pm.response.code`. A computed right-hand side (`jsonData.items.length + 1`) is left to the
human, and a local that was never bound to the response body is not read as one. One-line
`pm.test` wrappers, `function ()` and arrow alike, are unwrapped before the structural check.

Same collection now:

```yaml
assertions:
  - type: status
    equals: 200
capture:
  token: $.access_token
  userId: $.user.id
  reqId:
    header: X-Request-Id
```

— and the commented script is gone, because everything in it was understood.

**Then the other direction.** With the importer reading `pm.environment.set`, the exporter's
silence about `capture` became the remaining half of the same hole: `truspec` → Postman handed over
a login that checks the response and throws the token away. It now emits a `pm.test("capture", …)`
block, so the round trip preserves the chain exactly — asserted as such: export, re-import, and the
`capture` block comes back identical, with no leftover script.

**Verification.** 976 unit tests (8 new, including the round trip), coverage 96.04% lines / 87.74%
branches / 96.42% functions, typecheck 8/8, docs updated and building.

### 64 — the first minute, which nobody had looked at

**What I looked for.** Every UI iteration so far has assumed a workspace with requests in it. So I
started the web UI on an empty directory — which is what happens the first time anyone runs
`truspec serve` in a new project — and read the screen.

```
◢◤
select a request, or run the whole collection.
requests execute server-side via @truspec/core — no CORS, fully local.
[ + new request ]
```

It names two things that do not exist. There is no request to select and no collection to run. The
sidebar shows an empty tree with a filter box for filtering nothing, and **▶ run all** sits there
enabled — a button whose only possible outcome is "0 passed, 0 failed, ok", which is the shape of
every false green there is.

**What it says now.**

```
no requests here yet.
A request is one .tspec.yaml file in this directory. Create one, or import a
Postman / Bruno / Insomnia collection you already have.
[ + new request ]  [ import a collection ]  [ + environment ]
No environment yet — that is where {{baseUrl}} and the rest of your variables live.
```

Three things changed, each for its own reason:

- **Import is offered here.** For most people arriving from Postman, importing *is* the first
  minute — and the import dialog lived in the Flow view, which a new user has no reason to open.
  The button takes them there.
- **The environment is named.** A new workspace has no environment, so `{{baseUrl}}` resolves to
  nothing, and the first request fails for a reason the UI never mentioned. The offer only appears
  when there genuinely isn't one.
- **Run all is disabled with no requests**, and says why in its tooltip, rather than reporting a
  pass for a run that executed nothing — the same principle as iterations 40 and 55, applied to
  the button rather than to the exit code.

The ordinary empty state (a workspace with requests, none selected) is untouched, and a test
pins that: add one request and the old copy is back, run-all enabled.

**Verification.** 976 unit tests, 112 e2e (4 new, driving a server over a genuinely empty temp
directory rather than the shared fixture), typecheck 8/8.

### 65 — CI went red, and it was not the diff

**What happened.** Five consecutive heads on the PR came back with `e2e` and `build (ubuntu-22.04)`
failing, while every gate passed locally. The logs said why:

```
Get:29 https://dl.google.com/linux/chrome-stable/deb stable/main amd64 Packages [1405 B]
Err:29 https://dl.google.com/linux/chrome-stable/deb stable/main amd64 Packages
  Hash Sum mismatch
E: Some index files failed to download.
Failed to install browsers
Error: Installation process exited with code: 100
```

Google's apt CDN was serving a `Packages.gz` whose hash did not match its own `Release` file. The
hosted runner image ships that repository, `playwright install --with-deps` and the Tauri job's
`apt-get install` both run `apt-get update`, and `apt-get` exits 100 when *any* configured
repository fails — including one nothing in the job installs from.

**The fix is to stop depending on it.** Every job now drops the Google and Microsoft apt lists
before installing anything; the packages these jobs need all come from Ubuntu's own archives. Three
workflows, one step each. Not a retry, not a re-run: the dependency itself was the bug.

**A second, unrelated red.** `portability (macos-latest)` failed on
`watch.test.ts` — `expected 0 to be greater than or equal to 1`. The test writes a file and sleeps
250ms for the real `fs.watch` to fire. That is a race everywhere and a lost bet on macOS, where
the watcher is backed by FSEvents and coalesces events over most of a second.

Fixed by waiting for the condition instead of for the clock — poll to a 5s ceiling, and fail with
`condition not met within 5000ms` rather than an arithmetic riddle. Also `realpath` the temp
directory: macOS hands out `/var/folders/…`, a symlink to `/private/var/folders/…`, and a recursive
watch rooted at the link reports paths under the real one, so a watcher can miss its own events.
Faster than the old sleep on Linux, and no longer a coin toss on macOS.

Neither of these was caused by the campaign's changes — and neither is a reason to re-run and hope.
"Flake" is a description, not a diagnosis; both had a cause, and both causes are now gone.

**Verification.** 976 unit tests, watcher suite 11/11 with the polling wait, all three workflow
files re-parsed as YAML.

### 66 — "(no match)", and the ten minutes that follow it

**What I looked for.** A failing assertion is the moment the tool is judged. I pointed a request at
a server that returns a realistic body and deliberately failed one assertion of every type, to read
what a person actually gets.

Most of it is good — the value that was there, truncated sensibly, next to the value expected. One
line was not:

```
✗ jsonpath $.missing.deep → (no match) fails exists
```

True, and useless. It does not say whether `deep` is missing, `missing` is missing, the body was
not JSON at all, or an index ran off the end of an array. Every one of those has a different fix,
so the next step is always the same: go and open the body by hand. That is the single most common
few minutes of an API testing session, and the tool had the answer in memory the whole time.

**Now it says which step came up empty, and what was there instead:**

```
$.missing.deep  → (no match — $ has no "missing"; keys: id, name, tags, owner, description)
$.items[5]      → (no match — $.items has 2 item(s))
$.name.first    → (no match — $.name is a string, not an object)
$.tags.id       → (no match — $.tags is an array — index it with [n] or [*])
$.meta.anything → (no match — $.meta has no "anything"; it has no keys)
$.items[*].nope → (no match — no element of $.items[*] has "nope")
$.id (text/plain) → (no match — the response body is not JSON)
```

The key list is what makes a typo self-correcting: `$.ownr` prints `owner` two words later. It is
capped at five keys with a `…4 more`, because the point is a hint, not a dump of the object.

**How it is built.** `explainJsonPathMiss` walks the same steps evaluation walks — the stepping
logic is now one shared function, so the explanation cannot describe a different traversal from the
one that failed — and reports the first step that produced nothing. After a wildcard it declines to
name a specific element, because which one was meant is a guess. A path that does not parse gets no
explanation rather than an invented one.

**Verification.** 993 unit tests (17 new covering every shape, including the ones where it stays
quiet), coverage 96.00% lines / 87.75% branches / 96.47% functions, typecheck 8/8. One existing test
asserted the old bare `(no match)` message and was updated — deliberately, since that message is
the thing this iteration changed.

### 67 — "Run collection" meant the whole repository

**What I looked for.** The VS Code extension has never been examined in this campaign. Its
rendering escapes everything it prints (checked first, since a webview is where an unescaped body
would land), so I went looking at what its commands actually do.

**`Run collection` runs the workspace root.** The lens sits on the open file, so clicking it on
`api/admin/create-user.tspec.yaml` reads as "run the requests around this one". It ran
`findWorkspaceRoot(...)` instead — and `truspec init` puts `environments/` at the *repo* root, so
for the layout the tool itself scaffolds, the workspace root is the entire project.

That means one click sends every request in the repository. Not a slow no-op: real POSTs and
DELETEs, against whatever environment is selected, from a lens the user thought was scoped to what
they were looking at.

It now runs the directory the open file is in. The workspace root is still what environments and
secrets resolve against — `runPath` walks up for that itself — so nothing about variable resolution
changes. The lens is renamed **Run folder**, and the command title with it, because that is what it
does; the command *id* keeps its old name so an existing keybinding still works.

**And a spec the extension could not see.** `pickSpec` searched `**/*openapi*.{yaml,yml,json}`.
Half the specs in the wild are still called `swagger.yaml` — for those users, Drift and Coverage
reported "no OpenAPI spec found" against a repository with a spec sitting in it, which is
indistinguishable from the feature not working. The glob covers both names now, and the warning
says which names it looked for.

**Testing this needed a small change of approach.** The extension tests run the real engine behind
a mocked `vscode`, so nothing observed *which path* a command chose — the old test asserted only
the panel title and would have passed either way. `runPath` is now wrapped by a spy that records
its target and delegates to the real implementation, so the two new tests assert the decision
without stubbing the thing being tested.

**Verification.** 995 unit tests (3 new in the extension suite), coverage 96.00% lines / 87.77%
branches / 96.47% functions, typecheck 8/8, both READMEs and the editors page updated, docs site
builds.

### 68 — a mock that validated the envelope and not the letter

**What I looked for.** `mock --validate` is what a spec-first user points their client at to find
out whether the requests they send match the contract. I sent it four requests and read the
answers.

```
GET  /products                          -> 400  {"missing":["query:limit"]}       ✓
POST /products {"name":"x"}             -> 201  {}                                ✗
POST /products {"name":1,"priceCents":"free"} -> 201  {}                          ✗
```

The second and third are the ones that matter. `priceCents` is required and absent; `name` is
declared `string` and arrives as a number. Both got a 201. The mock was checking that *a* body had
been sent — never what was in it.

That is precisely backwards for the feature's purpose. A mock that agrees with a request the real
API will reject is worse than no mock: it certifies the bug.

Two reasons it could not do better. The engine kept only `bodyRequired` from each operation, not
the schema — even though iteration 53 had already put `requestBodySchema` on `SpecOperation` for
`gen`. And the server never read the body at all; it inferred `hasBody` from `content-length` and
threw the bytes away.

**Now:** the server reads the body (bounded at 2MB — a local mock has no reason to buffer whatever
arrives, and answers 413 past it), and the engine checks it with `validateAgainstSchema`, the same
validator behind the `schema` assertion and `truspec contract`. One validator, so the mock, the
runner and the contract report cannot disagree about what the spec says.

```json
{
  "error": "Request body does not satisfy the spec",
  "violations": [
    { "path": "/name", "message": "expected string, got number" },
    { "path": "/priceCents", "message": "expected integer, got string" }
  ]
}
```

**What it deliberately does not do.** A non-JSON media type (form, multipart) passes through —
there is no JSON Schema to check it against, and inventing one would be guessing. A body that is
not valid JSON gets its own message rather than a schema violation, because "your JSON is broken"
and "your JSON is wrong" send the reader to different places. And an absent required body still
reports `missing: ["body"]`, which is what iteration 54's test pinned.

**Verification.** 1003 unit tests (8 new: seven at the engine level, one over real HTTP proving the
server actually reads the body), coverage 95.98% lines / 87.80% branches / 96.49% functions,
typecheck 8/8, docs updated with the exact shape of the 400.

### 69 — the capture that quietly captured nothing

**Following iteration 66.** If "(no match)" was worth explaining for an assertion, the same miss in
a `capture` is worse: an assertion at least fails where the problem is. A capture that matches
nothing fails somewhere else entirely.

The probe — a login whose response field is `token_value` and whose capture reads
`$.access_token`, then a request that uses `{{token}}`:

```
✓ PASS  Login  (api/01-login.tspec.yaml)  200 28ms
✗ FAIL  Me     (api/02-me.tspec.yaml)
      error: Unresolved variables: {{token}}
```

The run fails, which is right. But everything it says is about the *consumer*. The request that
was supposed to produce the value is a clean green tick, and nothing anywhere mentions that its
capture came back empty. In a collection of any size the reader now goes looking for who was
supposed to set `token`.

**Now the producer says so, on its own line, with the reason:**

```
✓ PASS  Login  (api/01-login.tspec.yaml)  200 25ms
      ! capture token ← $.access_token matched nothing — $ has no "access_token"; keys: token_value
```

The whole diagnosis — which request, which variable, where it looked, and what is actually
there — in one line, because iteration 66's `explainJsonPathMiss` already knew how to say the last
part. A `{ header }` capture gets the equivalent (`the response has no X-Request-Id header`).

**It is a warning, not a failure**, and deliberately so: a collection may capture something nothing
consumes, and turning that into a red run would break working collections to report a
non-problem. Where it *does* matter, the run already goes red — at the consumer — and now the
producer's line explains it. The request that missed still reports `✓ PASS`, because it did pass.

The web UI shows the same thing beside the captured values, in the warning colour, so the "not
captured" chips sit next to the ones that worked.

**Verification.** 1011 unit tests (8 new) and 112 e2e, coverage 95.95% lines / 87.73% branches /
96.51% functions, typecheck 8/8, docs updated (the file-format note that used to read "simply
skipped" now shows what is printed instead).

### 70 — the machine-facing contract, and a gate that keeps it honest

**What I looked for.** The last several iterations added fields to `RunResult` — `bytes`,
`binary`, `bodyBase64`, `missedCaptures`. That object is not an internal detail: `truspec run
--json` hands it to CI reporters, the MCP tools hand it to agents, and the web client reads it. For
a project whose pitch is "agent-native", it is a published interface.

Both places that describe it were behind. Not only by my four:

```
docs/api.md: bytes, binary, bodyBase64, missedCaptures, redirects,
             redirectLimitHit, retries, iteration
docs/cli.md: missingVars, bytes, binary, bodyBase64, missedCaptures,
             redirectLimitHit, retries
```

`redirects`, `retries` and `iteration` predate this campaign entirely. Nobody consuming the JSON
would have known a data-driven run tags each result with its row, or that a 302 in the report might
be the third hop rather than the server's answer — both of which exist precisely so a machine can
tell.

**The fix is the gate, not the prose.** Documenting eleven fields once is worth little; they will
be behind again in five iterations. So the test reads the field names **out of `run.ts` itself**
and asserts each one appears in both documents. A field added without a doc line fails the run, and
the gate cannot be satisfied by editing a list of names inside the test — the list is derived from
the type that defines the contract.

It also asserts it found something to check (`ok`, `assertions`, `status`, and at least five
response fields), so a parser that silently matched nothing cannot pass as a clean run — the same
"a gate that checked nothing is worse than no gate" principle as iterations 40, 55 and 64, applied
to this gate itself.

Both documents now carry a table rather than a one-line type sketch, including which fields are
present only sometimes and why: `bytes` is not `bodyText.length`, `binary` means `bodyText` is
lossy, `redirectLimitHit` distinguishes the cap from the server, `iteration` is what makes a
data-driven failure traceable to its row.

**Verification.** 1014 unit tests (3 new, and the two contract tests fail against the docs as they
stood), coverage 95.95% lines / 87.73% branches / 96.51% functions, typecheck 8/8, docs site builds.

### 71 — what the transport did, and never mentioned

**What I looked for.** `timeoutMs` and `retries` are the two settings people lean on in CI. I ran
four cases against a server built to exercise them and read the reports.

The behaviour is right — the timeout fires at the limit, retries stop at the count, a per-attempt
timeout applies per attempt. The **reporting** hid two things.

**A timeout that named no limit.**

```
error: Timed out waiting for 127.0.0.1:40021
```

Which limit? The request's own `options.timeoutMs`, the run's `--timeout`, or the 30-second
default? Three different files to go and edit, and the message picks none of them. Now:

```
error: Timed out waiting for 127.0.0.1:40021 after 500ms
error: Timed out waiting for 127.0.0.1:40021 after 400ms (3 attempts)
```

The attempt count only appears when there was more than one, because "(1 attempts)" on every
ordinary timeout is noise.

**A 200 that took three tries looked like a clean 200.**

```
✓ PASS  Flaky  (api/r.tspec.yaml)  200 59ms
```

The server answered 503 twice before that. `retries` was already on the result — recorded in
iteration 19, never printed. A response that only arrived after a re-send is a fact about the API,
and the whole reason someone sets `retries` is that they suspect it; hiding the count hides the
evidence. Now `↻ re-sent 2 time(s) before this response`, in the human report, the HTML report,
and as a `↻2` beside the timing in the web UI.

**Same shape as three earlier iterations** — 51 made the redirect chain visible, 59 the real body
size, 69 the missed capture. Each time the runner already knew and the report did not say. That
pattern is worth naming: a field recorded on the result and never rendered is a fact the tool
collected on the user's behalf and then kept to itself.

**Verification.** 1021 unit tests (7 new: five over the message, two over the report), coverage
95.95% lines / 87.72% branches / 96.51% functions, typecheck 8/8, docs updated in both the
`options` reference and the `--json` field table.

### 72 — the view of the chain, with the break invisible

**What I looked for.** The Flow view is the feature that draws `capture → consume` edges between
requests: the picture of the chain. Iteration 69 made a missed capture visible in the CLI and the
workspace view; the Flow view is where it matters most. So I built a two-step chain whose capture
cannot succeed, ran it, and read the screen.

```
3  POST  Login   {{baseUrl}}/login   pass · 200
4  GET   Me      {{baseUrl}}/me      fail
```

Both lines are wrong in the same way. The step that *broke* the chain reports a clean pass — its
`$.access_token` matched nothing against a body that has no such field. The step that failed says
`fail` and nothing else: it never reached the network, so there is no status to show, and the
reason (`Unresolved variables: {{token}}`) was in the result and not on the screen.

The edge between them was already drawn as broken. But an edge that is broken tells you *that* the
chain snapped, and both endpoints refuse to say why — which is the whole question a person opens
this view to answer.

**Now:**

```
3  POST  Login   {{baseUrl}}/login                    ⚠ not captured   pass · 200
4  GET   Me      Unresolved variables: {{token}}      fail
```

The warning chip's tooltip carries the full diagnosis —
`token ← $.access_token matched nothing — $ has no "access_token"; keys: id, name` — and the
inspector spells it out beside the capture it belongs to. A step that failed with no response
shows the reason where its URL would be, since the URL is the one thing you already know.

**Verification.** 115 e2e (3 new), 1021 unit tests, typecheck 8/8. The third e2e is the one that
keeps this honest: a chain whose capture *does* succeed must show none of it, so the badge cannot
degenerate into decoration that is always on.

### 73 — a diff you could read but not gate on

**What I looked for.** `truspec env` is the command that has to be careful with secrets, so I ran
all of it against a workspace with two environments, a `.env`, and one secret set in the OS
environment. The listing and the per-environment view are good — values never printed, each secret
annotated with *where* it resolved from. Two gaps in the diff.

**It did not say which names are secrets.**

```
only in local (2):
  - apiKey
  - petId
```

`apiKey` is a secret and `petId` is a variable, and the fix for each is different: a missing
variable is added to the file, a missing secret is set in the environment that runs the collection.
Reading the diff, you cannot tell which you are looking at without opening both files — which is
the work the command exists to save. They are marked `(secret)` now, and `secretNames` is on the
JSON too, because the MCP tool hands this object to an agent that has to make the same distinction.

**And it could not fail.** The doc says `--diff` "exists for one boring failure in particular:
staging declares a variable production does not, so the collection runs green everywhere except
where it matters" — and then the command exits 0 whatever it finds. The one failure it was built
for was the one thing it could not gate on.

`--strict` exits 1 when either side declares a name the other does not. Differing *values* never
fail: environments are supposed to differ that way, and a gate that fires on `baseUrl` would be
turned off within a day.

**Verification.** 1026 unit tests (5 new, including one that pins the values-differ case as a
pass — the trap this flag could easily fall into), coverage 95.96% lines / 87.74% branches / 96.52%
functions, typecheck 8/8, docs and usage updated.

### 74 — drift named the operation and left you to find the file

**What I looked for.** `drift` is the flagship: the reason the product exists is that a collection
and a spec fall out of step. So I built a spec and a collection that disagree in every way the
report knows about, and read what it says.

The categories are right and the wording is good. One thing missing from every line:

```
Stale — not in the spec (1):
  - GET /search

Changed (2):
  ~ GET /products: missing required query param 'limit'
  ~ POST /products: missing required request body
```

Fixing any of these means editing a file. The report names an *operation* — so the reader greps a
hundred requests for whichever one carries that reference. And the report knows: it read the file
to notice in the first place, and `CollectionOp` has carried `filePath` all along.

```
  - GET /search  (api/legacy.tspec.yaml)
  ~ GET /products: missing required query param 'limit'  (api/list.tspec.yaml)
```

`--json` carries the same as `sources`, keyed by the entry text, because the MCP tool and the web
client have to make the same jump. When two requests produce the same entry — both pointing at a
removed operation — both files are listed rather than one arbitrarily winning.

**Untracked entries stay bare**, deliberately: an operation in the spec that no request references
has no file to name, and that is precisely what the category means.

**Same shape as 41, 51, 69, 71, 72** — the report has the fact and doesn't print it. That is now
five iterations of one pattern, which suggests it is worth checking for directly rather than
stumbling into: *for every line this tool prints, does it know something more specific it is
withholding?*

**Verification.** 1030 unit tests (4 new: three at the core level including the two-files case and
one asserting a clean report carries no `sources` at all, one over the CLI output), coverage 95.97%
lines / 87.77% branches / 96.53% functions, typecheck 8/8, docs updated.

### 75 — the credential the linter could not see

**What I looked for.** "Never inline secrets" is one of this project's four hard rules, and `lint`
is what enforces it. So I wrote the file a person actually writes when they are in a hurry, and
linted it.

```yaml
headers:
  Authorization: "Bearer eyJhbGciOi…"     ✗ error  inline-secret: looks like a JWT
  X-Api-Key: "9f8e7d6c5b4a39281706abcdef1234567890"    (nothing)
auth:
  token: "ghp_A1b2C3d4…"                  ✗ error  inline-secret: looks like a GitHub token
```

```yaml
url: "{{baseUrl}}/x?api_key=9f8e7d6c5b4a39281706abcdef1234567890&page=2"   (nothing)
```

The vendor patterns work — a JWT, a GitHub token, Stripe, AWS, Slack, Google, a PEM header all
fire. But a **plain opaque token has no shape to recognise**, and most API keys in the world are
exactly that: 32 hex characters, or a random base62 string, indistinguishable from an id. The
linter had nothing to match, so it said nothing.

What gives those away is the field they sit in. `X-Api-Key` announces its own contents; so does
`access_token`, `client_secret`, `password`. That is the one clue an opaque token cannot hide.

**`literal-credential-field`** (warning) fires when a credential-named field holds a literal:
headers, query parameters, body fields, auth fields — and **query parameters written into the URL**,
which the linter previously only ever saw as one long string. A credential in a query string is the
worst case of all: it lands in every access log on the way.

**Kept narrow on purpose**, because a noisy rule gets disabled and then catches nothing: a
`{{template}}` is not a literal, anything under 8 characters is not a token, `Bearer `/`Basic ` is
stripped before the length test, and obvious placeholders — `your-key-here`, `<token>`, `test`,
`changeme`, `xxxx` — are left alone. It is a warning rather than an error because the name is
strong evidence, not proof; `inline-secret` stays the error, since a matched vendor pattern *is*
proof. Its own rule id means a team with fixtures that trip it can disable exactly this one.

**Verification.** 1047 unit tests (17 new, half of them the false-positive table — the cases that
must stay silent are what decides whether a rule like this survives contact with a real
collection), coverage 95.98% lines / 87.77% branches / 96.55% functions, typecheck 8/8, and the
project's own `lint examples --strict` is still clean.

### 76 — the documentation printed the object instead of the sentence

**What I looked for.** `truspec docs` produces a Markdown file people commit and other people read.
So I read one.

```markdown
**Asserts**

- `{"type":"status","equals":201}`
- `{"type":"jsonpath","path":"$.id","exists":true}`
```

That is the internal object, printed into the one artifact whose entire purpose is being read by
someone who does not have the schema open. Captures were half the same: `{"header":"X-Id"}`.

Every other surface already speaks: the run report says `status 200 satisfies == 200`, the Postman
export names its tests, the flow view had its own third rendering. Three renderings of one thing,
each written separately, and the one people commit was the raw JSON.

**`describeAssertion` is now the shared one**, in `@truspec/core/format` — pure and
dependency-free, so the browser client uses it too:

```
- status is 201
- `$.id` exists
- responds in under 1000ms
- `$.n` ≥ 1 and ≤ 9
- header `Content-Type` contains "json"
- body matches the spec's response schema for status 201 as application/json
```

Conditions read as they combine (`is under 300 and is at least 200`), because a `jsonpath` with
four constraints is AND-ed and should say so. An assertion carrying no condition — `{ type: header,
name: X }` — still says something (`header \`X\` is present`) rather than trailing off; a test
pins that, since "never produces an empty description" is the failure mode a table like this has.

The Flow view's own version is deleted and calls this one: two surfaces describing the same
assertion differently is how a reader learns to distrust both.

**The committed example docs regenerate** into the new form, which the CI determinism gate then
compares byte-for-byte — the gate that already existed for exactly this kind of change.

**Verification.** 1063 unit tests (16 new) and 115 e2e, coverage 96.00% lines / 87.60% branches /
96.59% functions, typecheck 8/8, `git diff --exit-code examples` clean after regeneration.

### 77 — the last ✗ in the competitive table

**Where this came from.** Seventy-six iterations in, I went back to the research table this log
opens with and checked which gaps are still open. One row: **SSE / streaming**, which Postman,
Bruno, Insomnia and Hoppscotch all have. It is also the row that has aged into the most important
one — every LLM API streams, and "does my endpoint emit the right events" is a question people now
ask daily.

**What happened before.** A stream that *ends* worked by accident: the runner buffered the whole
body, so `body contains "chunk 3"` could match. A stream that does not end — the ordinary shape of
a chat completion — did this:

```
### SSE that never ends (timeout 1500ms)  exit=1
   status: undefined  bytes: undefined  bodyText: undefined
   error: Timed out waiting for 127.0.0.1:43503 after 1500ms
```

Everything the server had already sent was discarded to report a timeout. For a streaming endpoint
that *is* the response, thrown away in favour of an error message.

**Now:**

```
✓ PASS  Stream  (api/stream.tspec.yaml)  200 412ms
      ↯ 7 server-sent event(s) — stream closed at the limit, not by the server
```

- `text/event-stream` bodies are parsed into `response.events` — `{ event?, data, id? }` — with
  `bodyText` still carrying the raw stream, so nothing is hidden.
- A stream that never ends is closed after **200 events** rather than waiting for the request
  timeout, so a flooding endpoint returns in its own time (361ms in the probe, against an 8-second
  timeout).
- When the timeout *does* close a stream, what arrived is reported as a successful response with
  `streamTruncated: true`, rather than an error with nothing in it.

**The line I drew.** Only a *stream* is salvaged from a timeout. Half a JSON document is not a
response, and reporting a 200 for a request that did not complete would be a lie — that case still
errors, and a test pins it, using a server that writes `{"half":` and then stops. Likewise a stream
that timed out before sending anything has nothing to report and still fails.

**The parser follows the WHATWG format** rather than approximating it: multi-line `data:` joins
with a newline, exactly one leading space is stripped from a value, `:` comment lines (which is
what most keep-alives are) are dropped, CRLF and bare CR are accepted, and a block with no `data:`
is not an event. Six tests, one per rule.

**Iteration 70's gate did its job on the way through**: adding `events` and `streamTruncated`
failed the contract test until both were documented in `docs/api.md` and `docs/cli.md`.

**Verification.** 1075 unit tests (12 new), coverage 96.00% lines / 87.68% branches / 96.62%
functions, typecheck 8/8, docs updated in three places, and the competitive table at the top of
this log now has no open ✗.

### 78 — the macOS watcher failure, diagnosed properly this time

**What the last fix actually bought.** Iteration 65 changed this test from sleeping 250ms and
asserting `fired >= 1` to polling for the condition with a 5s ceiling. It kept failing on macOS —
but now it failed *legibly*:

```
× watchWorkspace > uses the real filesystem watcher by default and tears it down cleanly
  → Test timed out in 5000ms.
```

That is the difference between a wrong assertion (`expected 0 to be greater than or equal to 1`,
which reads like the watcher is broken) and the truth: **on macOS the event never arrives at all**,
not within 250ms and not within five seconds.

**Why.** `fs.watch` is backed by FSEvents on macOS, and FSEvents does not arm synchronously. The
test created the watcher and wrote the file in the same tick, so on that platform the write
happened before the watch was live — and no later event ever came, because there was no later
write. A single write is a coin toss there, and the coin was landing the same way every time.

**The fix is to keep writing until an event arrives**, rather than writing once and waiting. What
the test asserts is that *a real filesystem change reaches the watcher* — not that the very first
one does, which is a claim about FSEvents' arming latency and not about this code.

**And the second half was a vacuous pass waiting to happen.** After teardown it wrote a file and
waited 150ms to assert nothing fired. On a platform where delivery takes longer than that, nothing
firing proves nothing — the assertion would pass against a watcher that was simply deaf. It now
waits three times however long delivery actually took in the first half, which the polling loop
returns. A measured bound instead of a guess.

**Not a re-run.** The failure had a cause, the cause is gone, and the test is stronger on every
platform than it was before it started failing.

**Verification.** 1075 unit tests, watcher suite 11/11 in 345ms (faster than the fixed sleep it
replaced), typecheck 8/8.
