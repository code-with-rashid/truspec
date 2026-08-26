# UX Refinement — Round 11 (2026-08-26)

Continuing from [round 10](ux-round-10-report.md). First round in the "keep going" territory the
user opted into after the second checkpoint (bigger/riskier candidates: a persistent history view,
visual redesign). Picked the history view as the more concretely valuable, less subjective of the
two.

## Findings

- **No persistent, chronological record of individually-sent requests.** TruSpec's existing "runs"
  rail tab is a snapshot of the *latest* result per request (a `Map` keyed by path, overwritten on
  every send) — not a "what did I send, and when" log. Postman and Bruno both keep one.
  - **Where:** [`packages/web/src/App.tsx`](../../packages/web/src/App.tsx) — new `history` rail
    tab alongside the existing "this request" / "runs" tabs.
  - **Fix:** A `HistoryEntry` (method, url, name, path, status/error, duration, timestamp) is
    appended whenever a **single** request is sent (`doRun(target)` with a defined `target`) —
    deliberately **not** for a "run all" collection run, which already has the "runs" tab for
    exactly that. Persisted to `localStorage["truspec.history"]`, capped at the most recent 50
    entries, loaded eagerly on mount so it's available immediately (no loading flicker). Each row
    shows the method/name/status/relative-time/duration and, on click, reopens that request as a
    tab via the existing `openTab()` (the same function the sidebar and command palette already
    use) — no re-send, matching how the "runs" tab's rows already behave. A "clear" button empties
    it.
  - **Two real bugs found and fixed while building/testing this, both in my own new code:**
    1. The first implementation matched a run's result back to the just-sent request by comparing
       `normPath(res.filePath)` against the client-side `target` path — but the server's
       `filePath` is workspace-dir-prefixed while `target` is a plain relative path, so the
       comparison never matched and no entry was ever logged. Simplified instead of patching: a
       single-target run always returns exactly one result, so there's no path-matching needed at
       all — just take `r.results[0]`.
    2. The first regression test's send button selector was the bare class `.btn.run`, which
       matches **both** the top-bar "▶ run all" button and the request bar's "▶ send" button —
       Playwright silently resolved it to the first DOM match ("run all"), which produces the same
       visible response for a single-request fixture but — being a collection run, not an
       individual send — correctly does **not** log to history by this round's own design. Fixed
       by scoping the test's selector to `.req-top .btn.run`. (Not a product bug — a pre-existing,
       unrelated e2e test uses the same ambiguous selector and happens to still pass, since its
       assertions don't depend on which of the two same-effect buttons fired; left that one alone,
       out of scope for this round.)
  - **Verification:** In the real browser: sent `Get post`, switched to the new "history" tab, saw
    one entry (`GET`, "Get post", `200`, "Xs ago · Xms"); reloaded the page and confirmed the entry
    was still there; clicked it and confirmed it reopened `Get post` as a tab.
  - **Regression tests:** [`e2e/history.spec.ts`](../../e2e/history.spec.ts) — (1) sending a
    request adds a history entry that survives a reload and reopens the request on click; (2)
    running the whole collection adds nothing to history. Both fail on the pre-fix code (no
    `.rail-tab` for "history" exists at all) via the same stash/rebuild/run/pop cycle as prior
    rounds.

## Verification

- `pnpm typecheck` (full workspace) — 8/8 tasks pass.
- `pnpm --filter @truspec/web build` — pass.
- `pnpm test:e2e` — **38/38 passed** (36 pre-existing + 2 new), no regressions.

## Verdict

1 feature gap closed, with 2 bugs (1 in the feature's own initial implementation, 1 in its own
regression test) caught and fixed before landing — consistent with this session's pattern of
finding real defects by actually writing and running tests rather than trusting an implementation
by inspection. Continuing to round 12.
