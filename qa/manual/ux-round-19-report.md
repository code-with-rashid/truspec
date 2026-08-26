# UX Refinement — Round 19 (2026-08-26) — the docs/description field was read-only

Continuing from [round 18](ux-round-18-report.md). Closing out the last remaining read-only
request field: `docs` (a short description, per CLAUDE.md).

## Finding: a request's description could be viewed but never added or edited from the UI

- **Where:** [`packages/web/src/components/RequestWorkspace.tsx`](../../packages/web/src/components/RequestWorkspace.tsx),
  [`packages/web/src/styles.css`](../../packages/web/src/styles.css) (`.docs` → `.docs-edit`/`.docs-input`).
- **Symptom:** `{effective.docs && <p className="docs">{effective.docs}</p>}` — a plain, static
  paragraph shown only when `docs` already had content, with no button, no click target, nothing
  to add one on a request that had none. The smallest of this session's "read-only where it should
  be editable" findings (rounds 3, 17, 18), but the same class of gap, and cheap enough to close in
  the same pass while the pattern was fresh.
- **Fix:** Replaced the static paragraph with a `+ add description` button when `docs` is
  `undefined`, and a labeled, editable `.docs-input` textarea (sans font, matching the description's
  prose nature rather than the mono font used for code-like fields) plus a `remove` button when it
  is defined. Used `!== undefined` (not truthiness) to decide which to render — checking truthiness
  would have hidden the freshly-revealed empty textarea again the instant `+ add description` set
  `docs` to `""`, the same "vanishes before you can type into it" class of bug documented in
  [round 18](ux-round-18-report.md)'s capture editor and [round 10](ux-round-10-report.md) before
  that.
- **Verification:** In the real browser: added a description, saved, confirmed the file gained a
  correct `docs: ...` line; removed it, saved, confirmed the line disappeared entirely.
- **Regression test:** [`e2e/docs-editor.spec.ts`](../../e2e/docs-editor.spec.ts) — adds a
  description, saves, asserts the on-disk file contains it; removes it, saves, asserts it's gone.
  Ran 3x clean before the pre-fix check. **Failed on the pre-fix code** (no `+ add description`
  button exists on a read-only paragraph) — confirmed by hand-reverting this round's two changes,
  rebuilding (bundle hashed identically to the round-18 build), then restoring and rebuilding again
  (hashes matched the round-19 build exactly).

## Verification

- Hand-reverted, rebuilt, confirmed the new test fails, restored, rebuilt again — bundle hashes
  matched exactly on both sides of the cycle.
- `pnpm typecheck` (full workspace, Turborepo) — 8/8 tasks pass.
- `pnpm test:e2e` — **53/53 passed** (52 pre-existing + 1 new), no regressions.
- Manually tested in the live app; the on-disk test artifact was restored via `git checkout`
  afterward — confirmed clean via `git status --short examples/`.

## Verdict

Small, quick, closes out the read-only-field gap class entirely — every request field with
meaningful content is now inline-editable. Scoped to one component and one CSS rule; no
backend/core changes.
