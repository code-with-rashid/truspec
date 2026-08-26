# UX Refinement — Round 14 (2026-08-26) — responsive toolbar layout

The user asked for another pass aimed at closing the gap with Bruno/Postman further. Rather than
another feature-flow audit, this round surveyed the app's structural layout at realistic desktop
window sizes (a Tauri app's window is user-resizable — split-screen docking, smaller laptops, and
non-maximized windows are all normal), since none of the prior 13 rounds had tested that axis.

## Finding: the top bar and status bar had no responsive behavior — the whole app scrolled sideways instead of the toolbar adapting

- **Where:** [`packages/web/src/styles.css`](../../packages/web/src/styles.css) (`.topbar`,
  `.statusline`, `.seg`).
- **Symptom:** `.topbar` was a single `display: flex` row with every child (`brand`, `nav`,
  `search-btn`, `controls`, `spec-chip`, the run button) pinned to `flex-shrink: 0` and no
  `flex-wrap`. Measured via `scrollWidth`, its intrinsic content width is a fixed ~1101px that
  never shrinks — so at any window width below that, the row can't fit and the *entire document*
  scrolls horizontally instead. Below the fold, that meant: the flow/spec/mock nav tabs, the
  search/command-palette button, the env selector, the settings gear, and the "run all" button
  could all be scrolled off the right edge of the screen with zero visual indication that content
  existed there — no truncation, no overflow menu, nothing to suggest scrolling would help. The
  bottom status bar (`.statusline`/`.seg`, workspace path / env / coverage / drift chips) had the
  identical problem. Reproduced by resizing to 1000px, 900px, and 540px window widths: confirmed
  via `document.documentElement.scrollWidth` vs `clientWidth` that overflow started below ~1101px
  in every case (both narrower widths tested reported the *same* 1101px scroll width, confirming a
  fixed floor rather than a proportional squeeze), and via screenshot that the run button and mock
  tab were genuinely off-screen, not just visually cramped. Bruno and Postman's toolbars stay fully
  reachable at any window size the OS allows.
- **Fix:** Added `flex-wrap: wrap` to both `.topbar` and `.statusline`, changed their fixed
  `height` to `min-height` (so the row grows to two lines instead of overflowing), and added
  vertical padding/gap so wrapped rows don't touch. No component logic changed — this is layout
  CSS only. At typical desktop widths (tested at 1280px) the toolbar still renders as one row, just
  ~5px taller than before from the added padding; below ~1100px it now cleanly wraps onto a second
  line instead of pushing content off-screen. Verified interactions still work post-wrap (clicked
  the "flow" nav tab at a wrapped/narrow width in the real browser — it switched views correctly).
  A residual ~610px floor remains from the workspace's own `270px + minmax(0,1fr) + 340px` sidebar/
  rail grid — that's the accepted minimum for a three-pane layout (comparable to Postman/Insomnia's
  own practical minimums) and, unlike the toolbar bug, doesn't hide primary navigation when hit; a
  full collapsible-sidebar redesign to remove it entirely is out of scope for this round.
- **Verification:** Measured `scrollWidth`/`clientWidth` for `.topbar`, `.statusline`, and
  `document.documentElement` at 1200px, 1000px, 700px, and 540px window widths before and after the
  fix (via the browser's own JS console, both in a sandboxed pane and the user's real Chrome).
  Before: overflow at every width below 1101px. After: `.topbar`/`.statusline` never overflow their
  container at any tested width; only `.workspace`'s own ~610px content floor remains at the most
  extreme width (540px), and even there the toolbar and status bar stay fully visible and
  scroll-free. Screenshotted the wrapped toolbar in the real browser at a narrow width and confirmed
  it reads cleanly as two rows, then clicked the wrapped "flow" tab to confirm it's still fully
  interactive.
- **Regression test:** [`e2e/narrow-window-layout.spec.ts`](../../e2e/narrow-window-layout.spec.ts)
  — two tests: at 900px width, asserts no document-level horizontal overflow and that the "mock"
  nav tab and "run all" button are both fully within the viewport (not scrolled off-screen); at
  1280px, asserts the top bar's rendered height stays under 65px (i.e. still a single row, guarding
  against a future regression collapsing it into two rows unnecessarily at normal widths). The
  narrow-width test **failed on the pre-fix code** (`scrollWidth` 1146 vs an expected ≤900), while
  the wide-width regression guard already passed before and after — confirmed by stashing the CSS
  fix, rebuilding, and re-running.

## Verification

- Stashed the fix, rebuilt, re-ran `e2e/narrow-window-layout.spec.ts`: the narrow-width test failed
  as expected; the wide-width guard passed unaffected. Restored the fix and rebuilt.
- `pnpm typecheck` (full workspace, Turborepo) — 8/8 tasks pass.
- `pnpm test:e2e` — **45/45 passed** (43 pre-existing + 2 new), no regressions.

## Verdict

A structural layout gap that no prior round had tested for: at realistic non-maximized desktop
window widths, the app's own primary controls (navigation, run button, settings) could scroll
entirely out of view with no way for a user to discover they existed. That's the kind of thing that
reads as "broken" or "unfinished" rather than merely unpolished, and is exactly the class of gap
that separates a hobby tool from something that holds up against Bruno/Postman on a real, resized
window. Scoped entirely to `packages/web`'s CSS — no component or backend changes.
