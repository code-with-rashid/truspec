# UX Refinement — Round 1 (2026-08-26)

Scope: the user tried the desktop app and found it not UX/UI competitive with Bruno/Postman, and
asked for an iterative refinement loop — survey the running UI, fix the highest-value gap,
regression-test it, repeat — until it's genuinely competitive. This is a new effort, separate from
the bug-hunting `manual-qa-loop` rounds (`qa/manual/round-1..6-report.md`) from 2026-08-23/24;
those found and fixed 4 functional bugs. This round is about UX parity with Bruno/Postman
specifically, not correctness bugs.

Setup: `truspec serve --dir examples/blog`, driven visually through the user's real Chrome (via
the `claude-in-chrome` bridge) so every change could actually be screenshotted and inspected —
last session's QA rounds had no screenshot capability and had to reason from the DOM/text alone.

## Survey

Walked every top-level view (workspace/flow/spec/mock), both themes, multiple tabs, and the
request/response inline editor. The overall design language (dark terminal aesthetic, IBM Plex
Mono/Sans, lime accent, WCAG-AA-checked colors, resizable sidebar/rail, command palette, tab
strip, drag-and-drop tree) is already deliberate and reasonably polished — not the gap. The
concrete, evidence-based gap found this round:

## Findings

- **The request/response view was one scrolling column, not a split pane — the response was
  frequently pushed off-screen behind a wall of dead space.**
  - **Where:** [`packages/web/src/components/RequestWorkspace.tsx`](../../packages/web/src/components/RequestWorkspace.tsx),
    [`packages/web/src/styles.css`](../../packages/web/src/styles.css) (`.reqview`, `.response`).
  - **Symptom:** Open any request whose active tab has little content — e.g. a GET with 0 params,
    the common case — and the response section (status, body, assertions) was not visible without
    scrolling, even though nothing else on screen needed it. Screenshotted directly: after
    clicking **send** on `Get post`, the response panel rendered right at the bottom edge of a
    1568×769 viewport, clipped, with a blank gap above it roughly 500px tall.
  - **Root cause:** `.reqview` was `display:flex; flex-direction:column; min-height:100%` and
    `.response` had `margin-top:auto` — a "sticky footer" pattern that pins the response to the
    bottom of a min-height:100% container. Combined with the ancestor `.workspace > *
    {overflow:auto}` (the whole middle column scrolls as one unit), this meant: short tab content
    → response gets pushed to the bottom of the *viewport*, not the bottom of the content, leaving
    a dead gap and forcing a scroll to see it. This is the opposite of Postman/Bruno, where the
    response is a **docked, always-visible, independently-scrollable** pane directly under the
    request builder.
  - **Fix:** Converted the request/response area into a real vertical split, matching
    Postman/Bruno convention:
    - `.main` (the workspace's middle column) became a flex column that no longer scrolls itself;
      a new `.main-body` wrapper (holding whichever view is active) now owns that scroll — this
      is behavior-neutral for the Flow/Spec/Mock/Editor views, which already expected a
      definite-height ancestor.
    - `.reqview` is now `height:100%` with two children: `.reqview-top` (url bar, meta, dirty bar,
      tabs, tab content — `flex:1; overflow:auto`, scrolls independently) and `.response`
      (`flex-shrink:0`, an explicit pixel height, `overflow:hidden` with its own internal
      `.response-scroll` for the body/headers/assertions).
    - Added a draggable horizontal resize handle between them (`useResponseHeight` in
      `RequestWorkspace.tsx`, mirroring the existing `usePanelWidth` hook in `App.tsx`), persisted
      to `localStorage` under `truspec.responseHeight`, min 120px / default 320px, clamped so the
      top pane never gets squeezed below 160px.
    - The response's JSON/text block (`.response-body-wrap .body`) no longer caps at the old
      320px `max-height` — it now fills the resizable dock, so making the pane taller actually
      shows more of the body instead of leaving unused space beneath a fixed-height inner box.
    - When nothing has been sent yet, the dock shows a centered "send the request to see its
      response here." placeholder (or, if the last send errored, "no response body — see the
      error above.") instead of collapsing to a bare header — so the pane never again looks
      broken/empty by accident.
  - **Verification:** Screenshotted before/after in the real browser. Before: response clipped at
    the viewport edge behind ~500px of dead space. After: response head is visible immediately
    below the (now-short) params tab with no gap; sent a real request against the local mock
    server and confirmed the body/headers/assertions/captured sections render inside the dock;
    dragged the resize handle and confirmed the pane's height changes live and the drag persists
    (`localStorage`).
  - **Regression test:** [`e2e/request-response-split.spec.ts`](../../e2e/request-response-split.spec.ts) —
    two Playwright tests: (1) the response head is within the viewport bounds (no scroll needed)
    for a GET request with an empty params tab at 1280×720, and (2) dragging
    `.resize-handle.horiz` measurably changes `.response`'s height. Proved both fail against the
    pre-fix code (`git stash` the three changed files, rebuild, run — both failed: one on the
    viewport-bounds assertion, one on a `.resize-handle.horiz` locator timeout since the element
    didn't exist yet) and pass after `git stash pop` + rebuild.

## Investigated, no bug found

- **Flow view briefly showed "TypeError: Failed to fetch" with no visible empty-state message.**
  Traced this to the dev server (`truspec serve`) process itself having died mid-session (`curl`
  to `localhost:4100` returned nothing, `preview_list` showed zero running processes) — unrelated
  to the flow view's own code. Restarted the dev server and the flow view rendered correctly (3
  steps, order/method/url per step, "not run" pills). Not a product bug; noted so a future round
  doesn't re-chase it.
- Screenshot capture through the `claude-in-chrome` bridge intermittently returned a
  wrong-viewport/cropped image or timed out after an earlier region-zoom call — resolved by
  closing and reopening the tab. Harness flakiness, not a product issue.

## Verification

- `pnpm --filter @truspec/web typecheck` — pass.
- `pnpm typecheck` (full workspace, Turborepo) — 8/8 tasks pass.
- `pnpm --filter @truspec/web build` (client + server + sidecar) — pass.
- `pnpm test:e2e` — **19/19 passed** (17 pre-existing + 2 new), no regressions.
- Manually re-checked the other tabs (headers/body/auth/script/assertions) and both light/dark
  themes with the new split in place — all render correctly; the top pane scrolls independently
  when tab content is long (e.g. a script view), the response dock stays put.

## Verdict

1 high-severity UX gap found and fixed this round — the single most-used surface in an API client
(send a request, read the response) was frequently unusable without scrolling past dead space.
Continuing to round 2 to keep closing the gap with Bruno/Postman.
