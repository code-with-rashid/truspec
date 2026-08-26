# UX Refinement — Round 15 (2026-08-26) — the request editor could shrink to zero width

Continuing from [round 14](ux-round-14-report.md), which fixed the top bar and status bar so they
wrap instead of scrolling the whole document off-screen at narrow widths. That round flagged, as
out of scope, a "residual ~610px floor" from the sidebar/rail grid — described as an acceptable
three-pane minimum. Investigating it properly this round found that framing was wrong: it wasn't a
graceful floor, it was the single most important panel in the app silently disappearing.

## Finding: the main request/response column had no minimum width — it could shrink to literally 0px while the sidebar and rail stayed full-size

- **Where:** [`packages/web/src/styles.css`](../../packages/web/src/styles.css) (`.workspace`,
  `.workspace.no-rail`, `.url-bar .var-input-wrap`), [`packages/web/src/App.tsx`](../../packages/web/src/App.tsx)
  (the inline `gridTemplateColumns` that mirrors the CSS for the user-resizable sidebar/rail case).
- **Symptom:** The workspace grid was `270px minmax(0, 1fr) 340px` — sidebar, main, rail. The `0`
  floor on the main column meant that once the sidebar (270px) and rail (340px) alone exceeded the
  window width, the *main column got the squeeze first*, shrinking all the way to 0px, while the
  two secondary panels (folder tree navigation, spec-intelligence rail) stayed at full size.
  Confirmed via `getBoundingClientRect()`: at a 540px window, `.main` measured exactly `0`. This is
  backwards from what any user would expect — the primary content (the actual request you're
  editing and its response) should be the last thing to give ground, not the first. It also wasn't
  fixed by giving `.main` a floor alone: doing that first (`minmax(360px, 1fr)`) surfaced a second,
  identical bug one level deeper — the URL bar's own row (method badge + URL input + curl/save/send
  buttons) had the URL `<input>` wrapped in a `.var-input-wrap` with `min-width: 0` sitting behind
  three fixed-width buttons, so *it* shrank to a few px while the buttons stayed full size, even
  though `.main` itself had "enough" room on paper.
- **Fix:** Two floors, not one. `.workspace`'s main column: `minmax(0, 1fr)` → `minmax(500px, 1fr)`
  (mirrored in both `.workspace`/`.workspace.no-rail` in CSS and the inline style in `App.tsx`,
  which the sidebar/rail's drag-to-resize feature overrides at runtime). `.url-bar .var-input-wrap`:
  added `min-width: 140px` so the URL text itself is never the thing that disappears. `.workspace`
  also got `overflow-x: auto`, so when the combined floor genuinely doesn't fit (below ~1120px with
  the rail showing, ~775px without), the *workspace grid scrolls horizontally within itself* —
  complementing round 14's fix, which already keeps the top bar and status bar pinned and fully
  visible regardless. The net effect: below that width, you scroll to reach a panel, but nothing
  is ever invisible or literally 0px.
- **Verification:** Measured `.main` and `.url-input` widths via the browser's own JS at 540px,
  1000px, and 1280px window widths before and after, in both a sandboxed pane and the user's real
  Chrome. Before: `.main` = 0px, URL input unreachable. After: `.main` = 500px (its floor), URL
  input = 140px (its floor) at the narrowest width tested, and both revert to normal proportional
  sizing with zero scroll needed at 1280px (no visual change at typical desktop widths). Confirmed
  in the real browser that scrolling the workspace horizontally (via `scrollLeft`) reveals the rail
  panel while the top bar and status bar stay pinned in place, exactly matching round 14's chrome
  behavior.
- **Regression test:** [`e2e/narrow-window-main-collapse.spec.ts`](../../e2e/narrow-window-main-collapse.spec.ts)
  — two tests: at 540px width with a request open, asserts the URL input is visible with width
  ≥130px (its intended floor); at 1280px, asserts the workspace grid needs no internal scrolling
  (`scrollWidth` ≤ `clientWidth`, guarding against a future regression re-triggering scroll at
  normal sizes). The narrow-width test **failed on the pre-fix code** — Playwright reported the
  `.url-input` locator as not found/not visible at all (a 0-width input in a 0-width ancestor chain
  isn't considered visible), while the wide-width guard already passed before and after — confirmed
  by stashing the fix, rebuilding, and re-running.

## Verification

- Stashed the fix, rebuilt, re-ran `e2e/narrow-window-main-collapse.spec.ts`: the narrow-width test
  failed as expected (`.url-input` not found); the wide-width guard passed unaffected. Restored the
  fix and rebuilt.
- `pnpm typecheck` (full workspace, Turborepo) — 8/8 tasks pass.
- `pnpm test:e2e` — **47/47 passed** (45 pre-existing + 2 new), no regressions.

## Verdict

Round 14 correctly fixed the toolbar chrome but under-diagnosed the remaining gap as an acceptable
structural minimum. It wasn't — it was the app's core function (viewing and editing a request)
becoming completely unusable while secondary chrome stayed fully rendered, which is a much more
severe class of bug than "a bit of horizontal scroll." Both are now consistent: nothing in the app
can render at 0 width, and everything that doesn't fit is reachable via scroll instead of hidden.
Scoped to `packages/web`'s layout CSS and one matching inline style — no component logic changed.
