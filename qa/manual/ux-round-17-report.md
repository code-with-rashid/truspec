# UX Refinement — Round 17 (2026-08-26) — the script tab was read-only

Continuing from [round 16](ux-round-16-report.md). Surveying the remaining request-editing tabs
for the same "was read-only, now inline-editable" gap round 3 fixed for assertions turned up one
more: the script tab.

## Finding: pre-request and post-response scripts could only be viewed, never added, edited, or removed from the UI

- **Where:** [`packages/web/src/components/RequestWorkspace.tsx`](../../packages/web/src/components/RequestWorkspace.tsx)
  (removed the old `ScriptView`), new
  [`packages/web/src/components/ScriptEditor.tsx`](../../packages/web/src/components/ScriptEditor.tsx),
  [`packages/web/src/styles.css`](../../packages/web/src/styles.css) (new `.script-text`).
- **Symptom:** The "script" tab rendered `script.pre`/`script.post` inside a plain `<pre>` block if
  either existed, or a muted "no pre-request or post-response script on this request" line if
  neither did — with no button, no affordance, nothing clickable anywhere on that tab. A request
  with no script had no discoverable way to add one short of already knowing to open the raw YAML
  editor (`✎ edit`) and hand-writing a `script:` block from CLAUDE.md's documentation — a script is
  one of the more "advanced" fields, exactly the kind of thing a UI should surface an on-ramp for
  rather than silently requiring out-of-band knowledge. Every other request field with meaningful
  content (params, headers, body, auth, assertions) had already been made inline-editable across
  earlier rounds; script was the one left as pure read-only display.
- **Fix:** Replaced the read-only `ScriptView` with `ScriptEditor`, matching the same
  `.editor-text`-style textarea pattern `BodyEditor` already uses for its text/graphql bodies (new
  `.script-text` class: same mono font and panel styling, but a smaller `min-height: 90px` with
  `resize: vertical` rather than the raw editor's fixed 320px — a script is typically a few lines,
  not a full document). When a request has no pre-request or post-response script, each shows a
  `+ add pre-request script` / `+ add post-response script` button; clicking one reveals a labeled,
  editable block with a `remove` button and a short inline hint of the most relevant `tr.*` calls
  for that block (`tr.set`/`tr.uuid` for pre-request; `tr.set`/`tr.expect` against `tr.response`
  for post-response) — enough to get started without needing to leave the app for CLAUDE.md.
  Removing the last remaining block clears the whole `script` field from the request (rather than
  leaving a dangling empty `script: {}` in the saved YAML).
- **Verification:** In the real browser: opened a script-less request, confirmed both "add" buttons
  showed with no textarea present; added a pre-request script, typed into it, saved, and confirmed
  the file on disk gained a correct `script: pre: ...` block; clicked `remove` and saved again,
  confirmed the `script:` key disappeared from the file entirely, byte-for-byte back to (functionally)
  its original content.
- **Regression test:** [`e2e/script-editor.spec.ts`](../../e2e/script-editor.spec.ts) — adds a
  pre-request script, saves, asserts the on-disk file contains it; removes it, saves, asserts it's
  gone. Ran 4x clean before the pre-fix check. **Failed on the pre-fix code** (the
  `+ add pre-request script` button doesn't exist when the tab is pure read-only display) —
  confirmed by hand-reverting this round's three changes (moving the new `ScriptEditor.tsx` file
  aside, restoring the deleted `ScriptView` function and its call site in `RequestWorkspace.tsx`,
  and removing the new `.script-text` CSS), rebuilding — the resulting bundle hashed identically to
  the round-16 build, confirming an exact revert — then restoring all three and rebuilding again,
  which reproduced the round-17 bundle's hashes exactly.

## Verification

- Hand-reverted (not stashed — `RequestWorkspace.tsx` and `styles.css` both carry many prior
  rounds' accumulated changes, so a whole-file `git stash` would revert far more than this round's
  diff, per the lesson from [round 16](ux-round-16-report.md)) this round's three changes, rebuilt,
  and confirmed the new test fails. Restored all three, rebuilt, and confirmed the resulting
  bundle's asset hashes exactly matched the pre-revert build — proof the revert/restore cycle was
  lossless.
- `pnpm typecheck` (full workspace, Turborepo) — 8/8 tasks pass.
- `pnpm test:e2e` — **51/51 passed** (50 pre-existing + 1 new), no regressions.
- Manually tested in the live app; the one on-disk test artifact from manual testing
  (`examples/blog/posts/get-post.tspec.yaml`) was restored via `git checkout` afterward — confirmed
  clean via `git status --short examples/`.

## Verdict

Closes the last remaining "read-only where it should be editable" gap among the request-editing
tabs. Scoped entirely to `packages/web` — one new component, one CSS class, and swapping the
script tab's render call — no backend/core/CLI changes, since the `script` field's shape and
`truspec run`'s handling of it were already correct; only the UI's ability to touch it was missing.
