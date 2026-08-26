# UX Refinement — Round 5 (2026-08-26)

Continuing from [round 1](ux-round-1-report.md) through [round 4](ux-round-4-report.md) (response
split pane, inline method/URL, inline assertions, keyboard shortcuts + response copy).

## Findings

- **No way to export a request as a `curl` command.** Both Postman and Bruno offer this as a
  standard action on every request — useful for bug reports, docs, and reproducing a call outside
  the app. TruSpec had nothing equivalent.
  - **Where:** new [`packages/web/src/curl.ts`](../../packages/web/src/curl.ts) (pure builder),
    wired into [`packages/web/src/components/RequestWorkspace.tsx`](../../packages/web/src/components/RequestWorkspace.tsx)'s
    request bar.
  - **Fix:** `buildCurl(detail)` renders the request's method, URL (+ query string), headers,
    resolved auth (bearer → `Authorization: Bearer …`, basic → base64-encoded `Authorization:
    Basic …` via `btoa`, apikey → header or appended to the query string per its configured
    location), and body (json/text/form/graphql, each with the right `-d`/`--data-urlencode` and
    `Content-Type`) into a shell-quoted, multi-line `curl` command. Uses the request's own
    `{{var}}` placeholders as authored rather than resolving them against an environment (no
    server round-trip needed) — the same shape Bruno shows when generating a snippet from the
    request definition itself. Added a **curl** button next to "✎ edit" in the request bar, using
    the same copy-with-"copied ✓"-feedback pattern round 4 established for the response body.
  - **Verification:** In the real browser, on `Create post` (POST with a JSON body): clicked
    **curl**, confirmed the button flipped to "copied ✓". Full clipboard-content verification
    (rather than just the button's feedback state) was done through the e2e test below, since this
    session's ad hoc `navigator.clipboard.readText()` probe hung without Playwright's explicit
    `clipboard-read` permission grant.
  - **Regression test:** [`e2e/copy-as-curl.spec.ts`](../../e2e/copy-as-curl.spec.ts) — clicks
    `.curl-btn` on `Get pet`, asserts the button reads "copied ✓", and reads the clipboard back
    (via `context.grantPermissions(["clipboard-read", "clipboard-write"])`) to assert it contains
    `curl -X GET` and the request's URL. Proved it fails on the pre-fix code (`.curl-btn` doesn't
    exist — Playwright times out) via the same stash/rebuild/run/pop cycle as prior rounds.

## Verification

- `pnpm typecheck` (full workspace) — 8/8 tasks pass.
- `pnpm --filter @truspec/web build` — pass.
- `pnpm test:e2e` — **26/26 passed** (25 pre-existing + 1 new), no regressions.

## Verdict

1 gap found and fixed — a standard, expected export affordance that was entirely missing.
Continuing to round 6.
