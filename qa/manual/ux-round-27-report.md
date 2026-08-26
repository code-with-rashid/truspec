# UX Refinement — Round 27 (2026-08-26) — the spec dashboard couldn't jump to a request

Continuing from [round 26](ux-round-26-report.md). The spec view's operations table and
drift "what to resolve" lists were entirely static text, despite every one of their entries
corresponding to a specific, findable request.

## Finding: no way to jump from a spec operation or drift entry to its request

- **Where:** [`packages/web/src/App.tsx`](../../packages/web/src/App.tsx) (`SpecDashboard`,
  `specRefToPath`), [`packages/web/src/styles.css`](../../packages/web/src/styles.css)
  (`.op-row-link`, `.op-link`).
- **Symptom:** The operations table (`covered`/`uncovered` operations, each showing a
  tested/changed/untested badge) and the "what to resolve" drift lists (stale/changed entries)
  were plain `<div>`/`<code>` text. Both are keyed by the exact same spec-operation ref a request's
  own `spec:` block resolves to (already used elsewhere — `specRefOf()`, the request-detail rail's
  "⇄ operationId" badge) — so for any operation with an actual covering request, the dashboard
  already *knew* which request it meant, it just never let you click through to it. In a collection
  of any real size, seeing "GET /pets/{id} — changed" in the drift report meant manually searching
  the sidebar tree for whichever request handled that path.
- **Fix:** Built a `specRefToPath` map (operation ref → request path) from the same `state.requests`
  data every other spec-ref lookup in the app already uses. Operations-table rows with a matching
  request are now clickable (`op-row-link`, hover highlight, cursor pointer) and open that request
  via the same `jumpTo` already wired to the sidebar tree and command palette. "Stale" drift entries
  (a request exists, the spec dropped the operation) and "changed" entries (params/schema mismatch)
  get the same treatment — "changed" entries needed splitting the `"key: description"` string first
  to recover the bare key, mirroring logic the file already had for computing the operations
  table's own "changed" badge. "Untracked" (added) entries stay non-interactive by design — there's
  no request behind them to open.
- **Verification:** In the real browser: selected a spec, opened the spec view, confirmed covered
  operation rows rendered with the link styling and an uncovered row didn't; clicked a covered
  row and confirmed it switched to the workspace view with the correct request's tab opened.
- **Regression test:** [`e2e/spec-dashboard-click-through.spec.ts`](../../e2e/spec-dashboard-click-through.spec.ts)
  — asserts a "tested" operation row carries the link class and clicking it opens the matching
  request; asserts an "untested" row never does. Ran 3x clean before the pre-fix check. The
  clickable-row test **failed on the pre-fix code** (no `op-row-link` class present) while the
  not-clickable guard correctly stayed true both before and after (a real, meaningful negative
  check, not a tautology — it distinguishes "correctly inert" from "accidentally interactive" for
  the uncovered case) — confirmed by hand-reverting this round's changes across `App.tsx` and
  `styles.css` (both carry many prior rounds' history), rebuilding — bundle hashed identically to
  the round-26 build — then restoring and rebuilding again, matching the round-27 build's hashes
  exactly.

## Verification

- Hand-reverted, rebuilt, confirmed the expected test outcome (one failure, one unaffected pass),
  restored, rebuilt again — bundle hashes matched exactly on both sides; re-ran standalone to
  confirm both pass with the fix restored.
- `pnpm typecheck` (full workspace) — passes.

## Verdict

A real navigation gap in the one dashboard whose entire purpose is telling you something needs
attention in a *specific* request. Scoped to `packages/web`'s spec dashboard; no backend/core
changes — every piece of data needed was already being fetched, just never cross-referenced.
