# Manual E2E QA — Round 3 (2026-08-23)

Continuing from [round 1](round-1-report.md) and [round 2](round-2-report.md). This round is a
confirmation pass over the fixes so far plus a look at edges neither round had reached yet: a
malformed/unparseable OpenAPI spec file (an edge round 1/2 didn't probe — every prior spec-view
check used a valid spec), the light theme, and re-verifying prior fixes still hold after the
newest changes.

Setup unchanged: `truspec serve --dir examples/blog`, real Chromium via the Browser pane.

## Findings

### 1. A spec file that fails to parse left the spec view stuck forever, and silently claimed "0 drift issues" — FIXED

- **Where:** [App.tsx](../../packages/web/src/App.tsx) (the drift/coverage fetch effect,
  `SpecDashboard`, and the workspace-view "spec intelligence" rail)
- **Symptom:** Pointed the collection's `openapi.yaml` at deliberately-broken YAML (unbalanced
  `[`, invalid mapping) and reloaded. Two distinct problems, both confirmed live:
  1. The **Spec view** (main "spec" tab) got permanently stuck on "analyzing openapi.yaml…" — an
     infinite spinner with zero indication anything had gone wrong, even though the server had
     already responded to `/api/drift`/`/api/coverage` with a clean `500` and a real parse-error
     message.
  2. The **workspace-view rail** ("spec intelligence" card, visible while any request is selected)
     is worse: it rendered **`0` for untracked / stale / changed**, and "…" for coverage — which
     reads exactly like "spec analysis ran and found nothing wrong," when the true state is
     "analysis never ran at all." A user glancing at that card would wrongly conclude their spec
     was fully in sync.
- **Root cause:** the fetch effect's `.catch()` only set the generic app-wide `error` string (which
  renders as small text in the page footer — easy to miss, and not connected to either of the two
  UI locations above). Neither `SpecDashboard`'s loading check (`if (!driftRep || !covRep) return
  <analyzing…>`) nor the rail's `driftRep?.added.length ?? 0` pattern had any way to distinguish
  "still loading" from "failed forever" — both states look identical (`driftRep === null`) to that
  code, so a permanent failure renders exactly like a fleeting loading spinner (bad) or, in the
  rail's case, like a clean report (worse).
- **Fix:** added a dedicated `specErr` state, set on fetch failure (kept separate from the generic
  `error` used for other unrelated API failures) and cleared whenever a new spec analysis starts.
  `SpecDashboard` now checks `specErr` before the loading check and shows the actual error message
  instead of spinning forever. The rail's drift card now branches on `specErr` too: instead of the
  three-cell "0/0/0" grid, it shows a single "spec analysis failed" message (no numbers at all, so
  there's nothing to misread as a clean report); the coverage number shows `—` instead of an
  indefinite `…`.
- **Verification:** `pnpm --filter @truspec/web typecheck` clean; live re-test with the broken spec
  (Spec view showed "couldn't analyze openapi.yaml." + the real parse error; rail showed "spec
  analysis failed" with no numbers) and then with the spec restored to valid (both the Spec view's
  75%/drift·1 and the rail's matching numbers rendered exactly as before — the fix doesn't touch
  the happy path's output). Full e2e suite green.
- **Regression test:** new [e2e/spec-view.spec.ts](../../e2e/spec-view.spec.ts) — writes a
  malformed `openapi.yaml` into the test workspace, confirms the Spec view shows the error text
  (not stuck on "analyzing…") and the rail's `.drift-mini-grid` (the numeric 0/0/0 cells) is gone
  entirely. Confirmed it fails on the pre-fix code (`git stash` + rebuild — the error text never
  appears within the 5s wait) and passes after.

## Investigated, no bug found

- **Happy-path spec view / rail after the fix** — re-verified with the spec restored to valid
  content that coverage (75%), drift count (1), and the untested-operation list all still render
  identically to rounds 1–2's baseline; the new `specErr` branch doesn't interfere with normal
  rendering.
- **Light theme** — toggled and re-toggled; no console errors, no missing content. Detailed visual
  contrast checking is already covered by the existing automated `e2e/a11y.spec.ts` (axe-core
  against the light theme specifically), which this round's `pnpm test:e2e` run confirmed still
  passes — not worth re-doing by eye in a harness with no screenshot capability available this
  session.
- Stale console `[error] Failed to load resource… 500` / `beforeunload` blocked-panel entries seen
  mid-round turned out to be the *same browser tab* carrying over console history across a preview
  server restart from the malformed-spec test earlier in this round, not a new failure — confirmed
  by checking the actual live network log, which showed only fresh `200 OK` responses at that
  point. Recording this so a future round doesn't misread carried-over console noise as a live bug.

## Verification

- `pnpm --filter @truspec/web typecheck` — clean.
- `pnpm typecheck` (full workspace) — 8/8.
- `pnpm build` (full workspace) — 5/5.
- `pnpm test:e2e` — **17/17 passed** (was 16 at the end of round 2; +1 new regression test), no
  regressions.
- `examples/blog/openapi.yaml` restored from a scratchpad backup to its original valid content
  after the malformed-spec manual test; `git status` confirmed clean before wrapping up.

## Verdict

1 real bug found and fixed this round (spec-analysis failure presented as either an infinite
spinner or, worse, a false "everything's fine" report), with a regression test that fails pre-fix
and passes post-fix. This is round 3 with a real finding — the 3-consecutive-clean stop condition
resets from here. Continuing to round 4.
