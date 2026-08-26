# UX Refinement — Round 24 (2026-08-26) — the command palette promised more than it did

Continuing from [round 23](ux-round-23-report.md). Sixth round of this batch — closing with a
find in the command palette itself, which has been open in every round's manual testing without
anyone (including this session, until now) noticing its own placeholder text was aspirational.

## Finding: "jump to a request, run, or view…" — only requests actually worked

- **Where:** [`packages/web/src/components/CommandPalette.tsx`](../../packages/web/src/components/CommandPalette.tsx),
  [`packages/web/src/App.tsx`](../../packages/web/src/App.tsx) (`paletteCommands`,
  `runPaletteCommand`), [`packages/web/src/styles.css`](../../packages/web/src/styles.css).
- **Symptom:** The palette's input placeholder has always read `"jump to a request, run, or
  view…"`. The implementation, though, only ever filtered `state.requests` — there was no code
  path anywhere that let the palette switch views (spec/mock/flow) or trigger a collection run.
  Typing "spec" or "run" into the palette just searched request names/URLs/methods for those
  substrings and came up empty (unless a request happened to contain "spec" or "run" in its name).
  A gap between what the UI's own copy promises and what pressing Enter actually does.
- **Fix:** Added a small, static, always-present set of five commands (go to workspace/spec/mock/
  flow, run all requests), filtered by the same query text as request results and rendered above
  them with a distinguishing `→` glyph (never a method badge, so a command can't be mistaken for a
  request). Enter now runs the top command if one matches, falling back to the top request match
  otherwise — commands rank first, matching how a real command palette (VS Code, etc.) prioritizes
  actions over content search.
- **Verification:** In the real browser: opened the palette, typed "spec", confirmed only the
  filtered "go to spec view" command showed, clicked it, confirmed the nav switched to spec and the
  palette closed. Typed "run all", clicked the resulting "run all requests" command, confirmed it
  actually ran the collection (not just closed the palette).
- **Regression test:** [`e2e/command-palette-actions.spec.ts`](../../e2e/command-palette-actions.spec.ts)
  — two tests: typing a view name and clicking the matching command switches
  `.nav-btn.active`; typing "run all" and clicking the command asserts `.rail-tab.active` becomes
  "runs" (`doRun`'s own post-run side effect for an untargeted run) — a real, load-bearing signal
  that the run actually happened, not just that the palette closed. Ran 4x clean before the pre-fix
  check. **Both failed on the pre-fix code** (no `.palette-cmd` elements exist) — confirmed by
  stashing `CommandPalette.tsx` (its entire diff since `HEAD` was exactly this round's change,
  confirmed via `git diff --stat` before stashing — safe to stash outright) and hand-reverting
  `App.tsx`/`styles.css` (both carry many prior rounds' history), rebuilding — bundle hashed
  identically to the round-23 build — then restoring and rebuilding again, matching the round-24
  build's hashes exactly.

## Verification

- Stashed/hand-reverted per above, rebuilt, confirmed both new tests fail, restored, rebuilt
  again — bundle hashes matched exactly on both sides.
- `pnpm typecheck` (full workspace, Turborepo) — 8/8 tasks pass.
- `pnpm test:e2e` — **59/59 passed** (57 pre-existing + 2 new), no regressions.

## Verdict

Closes this batch (rounds 19-24) on a find that's been hiding in plain sight — literally in the
palette's own placeholder text — since the palette's introduction. Scoped to
`packages/web`'s command palette and its App-level wiring; no backend/core changes.
