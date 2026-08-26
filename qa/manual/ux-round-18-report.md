# UX Refinement — Round 18 (2026-08-26) — `capture` had no UI at all

Continuing from [round 17](ux-round-17-report.md). Surveying the remaining request fields for
UI coverage turned up the biggest gap yet: `capture` (saving a response value into a variable for
a later request) — one of CLAUDE.md's headline features, dedicated its own "Capture & chaining"
section — had no UI whatsoever, not even a read-only view.

## Finding: no way to declare a capture — only its post-run results were ever shown

- **Where:** [`packages/web/src/components/RequestWorkspace.tsx`](../../packages/web/src/components/RequestWorkspace.tsx)
  (new tab + type), new
  [`packages/web/src/components/CaptureEditor.tsx`](../../packages/web/src/components/CaptureEditor.tsx).
- **Symptom:** `RequestDetail.capture` (`Record<string, CaptureSource>`) was read by the app in
  exactly one place — computing `captured` for the response panel's post-run chips (`captured →
  available to later requests`) — but never rendered as an editable, or even viewable, field. A
  request's own declared `capture:` block was invisible in the UI entirely; setting one up (the
  canonical "login step captures a token, next request uses `{{token}}`" workflow CLAUDE.md itself
  documents) required opening the raw YAML editor and hand-writing it, with no on-ramp anywhere
  suggesting the feature existed short of reading the docs.
- **Fix:** Added a `capture` tab (between `script` and `assertions`) with a row-based editor
  mirroring `AssertionsEditor`'s established pattern: each row is a var name plus a typed source
  (`jsonpath` / `header` / `status`), reusing the same `.assert-row`/`.assert-name`/`.assert-value`/
  `.assert-type-select` CSS classes for visual consistency. Jsonpath sources serialize as the bare
  string shorthand (`token: "$.access_token"`) rather than the verbose `{ jsonpath: ... }` object
  form, matching how existing collections in this repo are actually written and CLAUDE.md's own
  "keep diffs clean" convention.
- **A real bug caught before shipping:** the first version derived its rows fresh from the
  `capture` prop on every render — the exact "vanishing row" footgun [round 10](ux-round-10-report.md)
  found and fixed elsewhere in this codebase (`rowsToObject`-style serializers drop any row with a
  blank key/name, so a freshly-added, not-yet-named row disappears before you can type into it).
  Clicking "+ add capture" silently did nothing, reproduced and confirmed via manual testing before
  writing the regression test. Fixed by giving `CaptureEditor` its own local `rows` state
  (`useState`, no `useEffect` needed — the tab-conditional wrapper in `RequestWorkspace` already
  fully unmounts/remounts this component on every tab switch or request change, which is when a
  reset is needed), matching `BodyEditor.formRows`'s exact pattern.
- **A second bug caught mid-manual-test, in my own test script, not the product:** a
  `document.querySelector('.row-action-btn.danger')` call meant to click the capture row's remove
  button instead hit the *first* match in the whole document — the sidebar's "delete folder"
  button (that class is reused across delete-confirmation triggers app-wide). It opened a
  destructive confirmation modal for the fixture's `posts` folder; caught immediately from the
  screenshot, cancelled without confirming, and verified via `git status`/`ls` that nothing was
  actually deleted (the app's own confirm-before-delete safety net did exactly its job). Fixed by
  scoping the query to `.assert-row .row-action-btn.danger` for the rest of manual testing, and
  the regression test uses Playwright's properly-scoped `row.locator(...)` chaining throughout to
  avoid the same class of mistake.
- **Verification:** In the real browser: added a capture with a jsonpath source, saved, and
  confirmed the file gained a correct `capture:` block using the clean shorthand form; switched the
  row's kind to `header` and confirmed the value field's placeholder updated accordingly; switched
  to `status` and confirmed no extra field renders (a bare boolean, nothing to type); removed the
  row, saved, and confirmed `capture:` disappeared from the file entirely.
- **Regression test:** [`e2e/capture-editor.spec.ts`](../../e2e/capture-editor.spec.ts) — adds a
  jsonpath capture, saves, asserts the on-disk file contains it; switches source kind and asserts
  the value field's placeholder changes; removes it, saves, asserts it's gone. Ran 4x clean before
  the pre-fix check. **Failed on the pre-fix code** (the `capture` tab doesn't exist — timed out
  waiting for a `.tab` with that text) — confirmed by hand-reverting this round's changes (moving
  the new `CaptureEditor.tsx` aside, reverting the tab type/button/panel additions in
  `RequestWorkspace.tsx`), rebuilding — the resulting bundle hashed identically to the round-17
  build — then restoring and rebuilding again, reproducing the round-18 bundle's hashes exactly.

## Verification

- Hand-reverted (not stashed, per the [round 16](ux-round-16-report.md)/[17](ux-round-17-report.md)
  lesson) this round's changes, rebuilt, confirmed the new test fails, restored, rebuilt again, and
  confirmed the resulting bundle's asset hashes exactly matched the pre-revert build.
- `pnpm typecheck` (full workspace, Turborepo) — 8/8 tasks pass.
- `pnpm test:e2e` — **52/52 passed** (51 pre-existing + 1 new), no regressions.
- Manually tested in the live app; the on-disk test artifact from manual testing
  (`examples/blog/posts/get-post.tspec.yaml`) was restored via `git checkout` afterward, and the
  accidental delete-folder confirmation dialog was cancelled without confirming — verified via
  `git status --short examples/` and a directory listing that nothing was actually deleted.

## Verdict

The largest UI-vs-schema gap found in this whole session: a headline, explicitly-documented feature
with zero UI representation, not even read-only. Scoped to `packages/web` — one new component and
a small, consistent addition to the existing tab machinery — no backend/core changes, since
`truspec run`'s capture/chaining logic was already correct; only the ability to author it inline
was missing.
