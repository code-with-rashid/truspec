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
| **SSE / streaming** | ✓ | ✓ | ✓ | ✓ | **✗** |

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

