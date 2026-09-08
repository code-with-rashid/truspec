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

