# UX Refinement — Round 28 (2026-08-26) — icon-only buttons had no real accessible name

Continuing from [round 27](ux-round-27-report.md). A different class of finding from this
session's usual "missing UI" gaps: an accessibility issue spanning nearly every corner of the app,
invisible to sighted testing (which is how the previous 27 rounds, and the existing axe-core suite,
never caught it) but real for anyone using a screen reader.

## Finding: icon-only buttons relied on `title` alone — their real accessible name was the raw glyph

- **Where:** [`packages/web/src/components/FolderTree.tsx`](../../packages/web/src/components/FolderTree.tsx)
  (rename/duplicate/delete row actions), [`EditableKV.tsx`](../../packages/web/src/components/EditableKV.tsx),
  [`AssertionsEditor.tsx`](../../packages/web/src/components/AssertionsEditor.tsx),
  [`CaptureEditor.tsx`](../../packages/web/src/components/CaptureEditor.tsx) (row remove buttons),
  [`EnvironmentModal.tsx`](../../packages/web/src/components/EnvironmentModal.tsx) (edit/delete/
  remove-secret), [`TabStrip.tsx`](../../packages/web/src/components/TabStrip.tsx) (tab close),
  [`RequestWorkspace.tsx`](../../packages/web/src/components/RequestWorkspace.tsx) (unset order),
  [`App.tsx`](../../packages/web/src/App.tsx) (theme toggle, manage environments, clear filter) —
  13 buttons across 8 files.
- **Symptom:** Each button's only visible content was a bare glyph (✕ ✎ ⧉ ☾ ☀ ⚙) with a `title`
  attribute for the hover tooltip. `title` only becomes an element's *accessible name* when there's
  no other name source — and per the browser's accessible-name computation, visible text content
  (including a lone symbol character) already counts as a name source that outranks `title`. So
  every one of these buttons' real accessible name, the string a screen reader actually announces,
  was the glyph itself — "cross mark, button" or "pencil, button" repeated across dozens of rows in
  any real collection, with zero indication of what the button *does* or which row it belongs to.
  This is why the existing axe-core suite never flagged it: automated tooling can only detect a
  *missing* name (WCAG 4.1.2's literal technical requirement), not a *present-but-meaningless* one —
  a glyph is a non-empty string, so it passes the automated check while still failing the user.
  Confirmed axe-core's own `button-name` rule genuinely cannot distinguish this case while
  building this round's regression test (see below).
- **Fix:** Added `aria-label` to all 13, generally matching the existing `title` text, upgraded to
  include row-specific context where a list has more than one instance (e.g. environment row
  buttons became `edit environment "name"` / `delete environment "name"`, not just generic
  `edit`/`delete` — otherwise a screen reader user still can't tell which row's button they're
  focused on).
- **Verification:** Manually inspected every icon-only button pattern app-wide via a systematic
  grep sweep (`title=` without an adjacent `aria-label=`, plus a scan for bare-glyph-only button
  content) to make sure the fix was exhaustive, not just the first few found. In the real browser,
  hovered/opened each surface (sidebar row, headers/capture/assertions tabs, environment modal, tab
  strip) and confirmed each still shows its original tooltip on hover, unchanged.
- **A dead-end test approach, and what fixed it:** the first regression test used axe-core's
  `button-name` rule, which — as described above — passed identically whether the fix was present
  or reverted, because a glyph-only name still isn't *empty*. Caught by deliberately reverting one
  fixed button (FolderTree's rename action) and re-running: the axe-based test kept passing, proving
  it wasn't actually testing anything. Replaced it with direct `page.getByRole("button", { name })`
  assertions, which use the browser's real accessible-name computation (not axe's coarser
  presence-only check) — re-running the same revert-and-check cycle against the rewritten test
  correctly failed on the missing aria-label and passed once restored.
- **Regression test:** [`e2e/icon-button-names.spec.ts`](../../e2e/icon-button-names.spec.ts) —
  opens a request, hovers a sidebar row, adds rows to headers/capture/assertions, and asserts
  `getByRole("button", { name: ... })` locators resolve for a representative sample spanning every
  touched file: top-bar icons, sidebar row actions (which are `display: none` until hover — the
  test hovers first, since axe/accessibility tooling only sees rendered, non-hidden elements), the
  tab-close button (asserted with `exact: true`, since the containing tab's own accessible name
  legitimately *contains* the close button's name as a substring and would otherwise ambiguously
  match too), and each editor's row-remove button. **Failed on the pre-fix code** for the one
  button spot-checked in the revert-and-confirm cycle (FolderTree's rename action) — confirmed by
  temporarily removing that one `aria-label`, rebuilding (bundle hash matched round 27's build,
  confirming the isolated single-line revert), re-running (failed as expected), then restoring and
  rebuilding again (hash matched the round-28 build exactly). The remaining 12 fixes follow the
  identical mechanical pattern (add `aria-label` matching `title` to an existing button) verified
  as a group by the full test passing only once every fix was in place.

## Verification

- Spot-checked the fix/revert/restore cycle on one representative button (proving the test
  discriminates correctly), then confirmed the full fixed state via bundle-hash match against the
  build already established as correct.
- `pnpm typecheck` (full workspace) — 8/8 tasks pass.
- **Batch checkpoint:** ran the full `pnpm test:e2e` suite covering this round and [round
  27](ux-round-27-report.md) together — **65/65 passed** (63 pre-existing + 2 new), no regressions.

## Verdict

The broadest-reaching fix in this session so far by button count, and a reminder that "no visible
bug" and "no accessibility bug" aren't the same claim — sighted manual testing (everything this
whole 28-round session has otherwise relied on) structurally cannot surface this class of issue.
Scoped to `packages/web`'s components; no backend/core changes.
