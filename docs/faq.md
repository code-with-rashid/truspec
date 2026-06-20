# FAQ & troubleshooting

Common questions and the errors you're most likely to hit, with fixes.

---

## General

### How is TruSpec different from Postman or Bruno?

TruSpec sits between them. Like **Bruno**, your collection is plain-text files in Git and
everything works offline with no account. Unlike either, TruSpec treats your **OpenAPI spec
as the source of truth** and ships first-class [drift detection](./spec-sync.md#drift),
[coverage](./spec-sync.md#coverage), a [local mock server](./mocking.md), and a [first-party
MCP server](./mcp.md) so AI agents and CI can run the collection and fail the build when
code drifts from the spec. See the comparison table in the
[main README](https://github.com/code-with-rashid/truspec#why-truspec).

### Do I need an account or network access?

No. TruSpec is local-first and offline — no account, ever. The only network traffic is the
HTTP requests *you* define (and an optional [`drift --live`](./spec-sync.md#probing-a-live-api---live)
probe). You can even run against a [generated mock](./mocking.md) with no real API at all.

### Do I have to have an OpenAPI spec?

No — you can author requests and run them without one. But the spec is what powers
[drift and coverage](./spec-sync.md), which is the main reason to choose TruSpec. If you
have a spec, [`truspec gen`](./spec-sync.md#scaffolding-from-a-spec) scaffolds a collection
from it in one command.

### What Node version do I need?

Node **≥ 22**. TruSpec relies on the platform `fetch` and modern streaming APIs.

### Is there a single-file binary?

A Bun-compiled, zero-install binary is on the roadmap. For now, install the `truspec`
package or use `npx truspec …`.

---

## Files & format

### "Invalid TruSpec request: …" / unknown key errors

Every file type is **strict** — unknown keys are rejected so typos surface immediately. A
common one is `assertion:` instead of `assertions:`, or a misspelled field inside an
assertion. Check the error message: it names the path and the problem. The
[file format reference](./file-format.md) lists every valid field.

### My assertion always fails even though the response looks right

Two frequent causes:

- **An assertion with no condition always fails.** `{ type: status }` with no `equals` /
  `in` / `lt` / `gte` can't pass — give it a condition.
- **`jsonpath` needs a JSON body.** If the response isn't JSON (or didn't parse), `jsonpath`
  assertions won't match. Use a [`body`](./file-format.md#assertions) assertion for
  non-JSON responses.

When several conditions are on one assertion, **all** must hold.

### "Unresolved variables: `{{baseUrl}}`"

A `{{name}}` in the request had no value. Make sure:

- you passed `--env <name>` and the variable is in that environment's `variables:`, or
- it's a declared [secret](./file-format.md#environment-files) available in your OS env /
  `.env`, or
- it was [captured](./file-format.md#chaining-with-capture) by an earlier request that runs
  *before* this one (lower `order`).

The run fails **before sending** the request and lists exactly which names were missing.

### How do I order requests so a login runs first?

Set `order:` (lower runs first; default `0`, ties broken by file path). Capture the token in
the login request and reference it downstream — see
[Chaining with capture](./file-format.md#chaining-with-capture).

---

## Secrets

### Where do secret values live?

Never in your files. The environment lists secret **names** under `secrets:`; values are
resolved at run time from a workspace `.env` file and real OS environment variables (OS
wins). See [Environments](./file-format.md#environment-files).

### "Warning: unresolved secrets (set as env vars): token"

You declared `token` in `secrets:` but no `token` value was found in your OS env or `.env`.
Provide it — e.g. `token=… truspec run …`, or in CI via an `env:` block
([CI guide](./ci.md#secrets-in-ci)). The run still proceeds, but any `{{token}}` will be
unresolved.

### Will my token leak into CI logs or `--json` output?

No — resolved secret values (6+ characters) are **masked with `***`** everywhere they could
surface: URLs, bodies, headers, captured values, and error messages, including the
percent-encoded form in query strings. (Very short secrets are skipped to avoid masking
ubiquitous substrings.)

---

## Running & CI

### What do the exit codes mean?

`0` success · `1` failure (assertions failed / drift detected / coverage below `--min` / a
runtime error) · `2` usage error (missing required arg or flag). See
[CLI → Exit codes](./cli.md#exit-codes).

### How do I produce a report CI can display?

Use `--reporter junit --output report.xml` and point your platform's test-report ingestion
at the file. See [CI → JUnit reports](./ci.md#junit-reports).

### A slow server hangs my run

Each request has a **30s default timeout**. Lower it with `--timeout <ms>`, or pass `0` to
disable. Responses are also capped (50 MB default) so a hostile/buggy server can't exhaust
memory.

---

## Spec sync

### `drift` reports an endpoint as "untracked" — why?

The operation is in your spec but no request [references it](./file-format.md#spec-link).
Either add a request with a matching `spec:` block, or run
[`truspec gen`](./spec-sync.md#scaffolding-from-a-spec) to scaffold one. This is working as
intended — it's how drift catches new endpoints that ship without a test.

### "Changed" drift — what triggers it?

A request matches a spec operation but no longer satisfies it: the spec marks a **query
parameter as required** and the request omits it, or the spec marks the **request body as
required** and the request has none. Update the request to match the tightened contract.

### Coverage says an operation is uncovered even though I have a request for it

Coverage only counts a request that **has assertions**. A request with an empty
`assertions:` list references the operation but asserts nothing, so it doesn't count. Add at
least one assertion. See [Coverage](./spec-sync.md#coverage).

### `drift --live` skipped some operations

The live probe **only sends `GET` and `HEAD`** (to stay safe against a real/production
target); mutating operations are reported as skipped, not probed. See
[Probing a live API](./spec-sync.md#probing-a-live-api---live).

---

## Mock & web UI

### The mock returns 404 for a path that's in my spec

The mock matches operations from the spec's `paths`. Check the path template matches
exactly (including parameter braces) and the method is supported. Routes not defined in the
spec return `404`.

### "Web UI not available — build it with `pnpm --filter @truspec/web build`."

You're running `truspec serve` from a source checkout where the web bundle hasn't been
built. Build it once and re-run. Installed-from-npm `truspec` bundles it. See
[Editors → Web UI](./editors.md#web-ui).

---

## Agents (MCP)

### Can an agent write a broken `.tspec.yaml`?

No — the [`create`/`update` MCP tools](./mcp.md#tools) validate against the schema and
reject unknown keys before writing, and all writes are confined to the workspace directory
the server was launched in.

### The agent says a mock is "already running"

`truspec_mock_start` runs one mock per server instance. Stop it with `truspec_mock_stop`
before starting another, or reuse the URL it returned. See [MCP → Tools](./mcp.md#tools).

---

## Still stuck?

- Re-check the relevant reference: [File format](./file-format.md) · [CLI](./cli.md) ·
  [Programmatic API](./api.md).
- Search or open an issue: <https://github.com/code-with-rashid/truspec/issues>.
