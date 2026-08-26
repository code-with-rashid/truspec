# UX Refinement — Round 22 (2026-08-26) — `order` (run order) had no UI at all

Continuing from [round 21](ux-round-21-report.md). CLAUDE.md documents `order` and `capture`
together under "Capture & chaining" as the two fields that make request chaining work — round 18
gave `capture` a UI; `order` had none at all, not even read-only.

## Finding: no way to see or set a request's explicit run order

- **Where:** [`packages/web/src/components/RequestWorkspace.tsx`](../../packages/web/src/components/RequestWorkspace.tsx)
  (`req-meta` row), [`packages/web/src/styles.css`](../../packages/web/src/styles.css).
- **Symptom:** `RequestDetail.order` (`order?: number`) had zero references anywhere in
  `RequestWorkspace.tsx` — not displayed, not editable. CLAUDE.md's own chaining example
  (`01-login.tspec.yaml → order: 1`, `02-call.tspec.yaml → order: 2`) relies on it to control
  execution sequence without needing filename tricks, and it's the direct companion to round 18's
  capture editor — a login step that captures a token is only useful if it's guaranteed to run
  *before* the step that needs `{{token}}`. Requests fall back to path-alphabetical order when
  unset, which is often fine, but there was no way to override it short of the raw YAML editor.
- **Fix:** Added a small pill in the `req-meta` row (next to the request name and spec-link badge):
  a dashed `+ order` button when unset, and — once set — an editable number input plus a remove
  (`✕`) button, matching the `.badge-link`/`.badge-stale` visual weight already established there
  so it doesn't compete with the name for attention. Deliberately opt-in (hidden until explicitly
  added) rather than always-visible, since most single-request-per-file collections never need it —
  matches the "+ add X" convention from rounds 17-19's script/capture/docs editors, applied here to
  a scalar field rather than a collection.
- **Verification:** In the real browser: clicked `+ order`, confirmed a `0`-valued input appeared
  (not vanishing — `order: 0` is `!== undefined`, avoiding the same "empty value hides itself"
  class of bug rounds 18/19 fixed elsewhere); set it to `3`, saved, confirmed the file gained
  `order: 3`; removed it, saved, confirmed the line disappeared entirely.
- **Regression test:** [`e2e/order-editor.spec.ts`](../../e2e/order-editor.spec.ts) — adds an
  order, sets it to 3, saves, asserts the on-disk file contains `order: 3`; removes it, saves,
  asserts it's gone. Ran 3x clean before the pre-fix check. **Failed on the pre-fix code** (no
  `.order-add` button exists) — confirmed by hand-reverting this round's two changes (both
  `RequestWorkspace.tsx` and `styles.css` carry many prior rounds' history, so hand-reverted rather
  than stashed, per the round 16 lesson), rebuilding — bundle hashed identically to the round-21
  build — then restoring and rebuilding again, matching the round-22 build's hashes exactly.

## Verification

- Hand-reverted, rebuilt, confirmed the new test fails, restored, rebuilt again — bundle hashes
  matched exactly on both sides.
- `pnpm typecheck` (full workspace, Turborepo) — 8/8 tasks pass.
- `pnpm test:e2e` — **56/56 passed** (55 pre-existing + 1 new), no regressions.
- Manually tested in the live app; the on-disk test artifact was restored via `git checkout`
  afterward — confirmed clean via `git status --short examples/`.

## Verdict

Completes the "Capture & chaining" feature pairing started in round 18 — both fields a user needs
to author a multi-step request chain are now reachable without the raw YAML editor. Scoped to one
component and one CSS block; no backend/core changes.
