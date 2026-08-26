# UX Refinement — Round 25 (2026-08-26) — duplicating a request didn't open it

Continuing from [round 24](ux-round-24-report.md), start of a larger batch. This round: a
duplicate action that worked correctly on disk but left the user to find its own result.

## Finding: duplicating a request silently refreshed the tree instead of opening the copy

- **Where:** [`packages/web/src/App.tsx`](../../packages/web/src/App.tsx) (`doDuplicate` and its
  two call sites — the row hover-action button and the context menu).
- **Symptom:** The server side of duplication was already good: `POST /api/duplicate` derives a
  sensible destination path and, for requests, suffixes the internal `name:` field with " (copy)"
  so two similarly-named requests are easy to tell apart — genuinely thoughtful naming, not the
  gap. The client, though, called `duplicatePath(path)`, refreshed the sidebar tree
  (`setState(await getState())`), and stopped there. The new file existed on disk and in the tree,
  but nothing pointed at it — no open tab, no selection, no scroll-into-view. In a collection with
  more than a handful of requests (especially inside a collapsed folder), the user had to manually
  hunt for "Name (copy)" themselves. Postman and Bruno both land you on the new copy immediately.
- **Fix:** `doDuplicate` now takes the row's `kind` (already available at both call sites) and, for
  a duplicated *request* (not a folder — there's no "tab" concept for those), opens the new file's
  tab using the `path` the duplicate endpoint already returns. No new API surface — the response
  shape already had everything needed.
- **Verification:** In the real browser: hovered a request row, clicked its duplicate action,
  confirmed "Get post (copy)" opened as the active tab immediately, fully editable, instead of just
  appearing in the tree.
- **Regression test:** [`e2e/duplicate-opens-tab.spec.ts`](../../e2e/duplicate-opens-tab.spec.ts)
  — duplicates a request via its row action and asserts both a matching tab-strip item and the
  open request's own name reflect the copy. Ran 3x clean before the pre-fix check. **Failed on the
  pre-fix code** (no matching tab-strip item — the tree updated but nothing opened) — confirmed by
  hand-reverting this round's changes (`App.tsx` carries many prior rounds' history, so
  hand-reverted rather than stashed), rebuilding — bundle hashed identically to the round-24
  build — then restoring and rebuilding again, matching the round-25 build's hashes exactly.

## Verification

- Hand-reverted, rebuilt, confirmed the new test fails, restored, rebuilt again — bundle hashes
  matched exactly on both sides; re-ran the new test standalone to confirm it passes with the fix
  restored.
- `pnpm typecheck` (full workspace) — passes.
- Test artifact from manual testing (`examples/blog/posts/get-post-copy.tspec.yaml`) removed
  afterward — confirmed clean via `git status --short examples/`.
- Full `pnpm test:e2e` deferred to a batched checkpoint later in this round series (per the pacing
  note at the start of this batch) rather than re-run after every single round — this round's own
  isolated pre/post-fix proof already gives strong confidence it doesn't regress anything unrelated.

## Verdict

A small, concrete finish-the-loop fix — duplication now behaves the way every comparable tool's
does. Scoped to `packages/web/src/App.tsx`; no backend/core changes, since the server's response
already carried everything the client needed.
