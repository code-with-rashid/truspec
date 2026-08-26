# UX Refinement — Round 26 (2026-08-26) — the tab strip had no bulk-close

Continuing from [round 25](ux-round-25-report.md). A missing standard editor feature: with the
existing tab strip already supporting many open requests (round 14 confirmed it scrolls
horizontally rather than overflowing), there was no way to close more than one at a time.

## Finding: no context menu on tabs — no close others, no close all

- **Where:** [`packages/web/src/components/TabStrip.tsx`](../../packages/web/src/components/TabStrip.tsx),
  [`packages/web/src/App.tsx`](../../packages/web/src/App.tsx) (`closeOtherTabs`, `closeAllTabs`,
  `handleTabContextMenu`).
- **Symptom:** Right-clicking a tab did nothing but fall through to the browser's own native
  context menu — a jarring, distinctly "this is a webpage, not an app" moment in an otherwise
  chrome-consistent UI. The only way to close multiple tabs was clicking each one's individual "✕"
  in turn. Every comparable editor (VS Code, Chrome itself, Postman, Bruno) offers "close others"
  and "close all" once more than a couple of tabs are open, which happens routinely in normal use.
- **Fix:** Wired `TabStrip`'s tab items to a new `onContextMenu` prop (`preventDefault()`s the
  native menu, forwards to the app), reusing the same `ContextMenu`/`ctxMenu` infrastructure the
  sidebar tree's own right-click menu already uses — no new UI primitive needed. Added `close`,
  `close others`, and `close all` items. Deliberately scoped the safety story to be simple and
  foolproof rather than adding a new bulk-confirm flow: both bulk actions only ever drop tabs that
  aren't dirty — a tab with unsaved edits is silently left open, exactly mirroring how VS Code's own
  bulk-close treats unsaved files. No data loss is possible by construction; nothing new to test for
  edge cases around a multi-file confirm dialog.
- **Verification:** In the real browser: opened 3 tabs, right-clicked one, confirmed the menu
  showed all three actions; clicked "close others" and confirmed only the target tab remained;
  reopened all 3, made one dirty (added an unsaved header), clicked "close all", and confirmed the
  dirty tab survived while the two clean ones closed.
- **Regression test:** [`e2e/tab-context-menu.spec.ts`](../../e2e/tab-context-menu.spec.ts) — two
  tests: the context menu shows all three actions on right-click; a dirty tab survives "close all"
  (both tab count and its dirty-dot indicator still present afterward). Ran 2x clean before the
  pre-fix check. **Both failed on the pre-fix code** (no `.context-menu` appears on tab right-click
  at all) — confirmed by hand-reverting this round's changes across both files (`App.tsx` carries
  many prior rounds' history; `TabStrip.tsx`'s diff, verified via `git diff --stat`, was confirmed
  to be exactly this round's own change, reverting to a byte-identical match with `HEAD`), rebuilding
  — bundle hashed identically to the round-25 build — then restoring and rebuilding again, matching
  the round-26 build's hashes exactly.

## Verification

- Hand-reverted, rebuilt, confirmed both new tests fail, restored, rebuilt again — bundle hashes
  matched exactly on both sides; re-ran the tests standalone to confirm they pass with the fix
  restored.
- `pnpm typecheck` (full workspace) — passes.
- **Batch checkpoint:** ran the full `pnpm test:e2e` suite covering this round and [round
  25](ux-round-25-report.md) together — **62/62 passed** (60 pre-existing + 2 new), no regressions.

## Verdict

Closes a real gap that becomes more noticeable the longer a session runs and more tabs pile up.
Scoped to `packages/web`'s tab strip and its App-level wiring, reusing existing context-menu
infrastructure rather than introducing a new one; no backend/core changes.
