# UX Refinement — Round 13 (2026-08-26) — import collection + new folder flows

The user asked to continue the refinement loop and specifically pointed at two flows they called
out as "still primitive and not user friendly": importing a Postman/Bruno collection, and creating
a new folder. Both flows worked, but neither matched the guided-modal pattern the rest of the app
had already converged on (new request, environments, folder settings) — this round brings them in
line and adds a missing safety step to import.

## Findings

### 1. "New folder" was a bare, unlabeled inline sidebar row

- **Where:** [`packages/web/src/App.tsx`](../../packages/web/src/App.tsx) (sidebar render,
  `openNewFolder`/`doCreateFolder`/`closeNewFolder`), new
  [`packages/web/src/components/NewFolderModal.tsx`](../../packages/web/src/components/NewFolderModal.tsx).
- **Symptom:** Clicking "new folder" (top-level, or from a folder's own context menu) dropped a raw
  `<input>` directly into the sidebar tree, with only a placeholder string ("folder/subfolder") for
  guidance — no heading, no label, no indication of where the folder would actually land when
  opened from a folder's context menu (the target path was silently prefixed under the hood).
  Every other creation flow in the app (new request, environments, folder settings) already used
  the shared `.modal`/`.modal-head`/`.modal-body`/`.modal-actions` chrome; this one didn't.
- **Fix:** Added `NewFolderModal.tsx`, matching the established modal chrome, with a real "name"
  label and a live hint line showing the exact path that will be created —
  `inside posts — creates posts/nested` when opened from a folder's context menu, or a "creates
  nested folders in one go" hint when the user types a `/` themselves at the top level. `App.tsx`'s
  `newFolderPath` state (a pre-built path string) became `newFolderPrefix` (just the parent, or
  `undefined`); `doCreateFolder` now takes the resolved path as an argument from the modal's
  `onCreate` callback instead of reading it from closure state. Removed the old inline row and its
  now-dead CSS (`.new-folder-row`, `.new-folder-input`, `.new-folder-err`) from
  [`styles.css`](../../packages/web/src/styles.css).
- **Verification:** Exercised both entry points in the real browser (via the `claude-in-chrome`
  bridge): top-level "new folder" creates the modal with no prefix; right-clicking an existing
  folder's row and choosing "new folder" opens it with the prefix hint showing the nested path
  before submission. Confirmed the resulting on-disk paths matched what the hint promised.
- **Regression test:** [`e2e/new-folder-modal.spec.ts`](../../e2e/new-folder-modal.spec.ts) — two
  tests: top-level folder creation via the modal, and nested creation via a folder's context menu,
  asserting both the live hint text and the final on-disk path. Both **timed out waiting for
  `.modal input.kv-input`** on the pre-fix code (the old inline row has no modal), confirmed by
  stashing the fix and re-running.

### 2. Import wrote to disk the instant a file was picked, with no preview or reviewable target

- **Where:** [`packages/web/src/FlowView.tsx`](../../packages/web/src/FlowView.tsx)
  (`onPostmanFile`/`onBrunoDir`, new `confirmImport`/`cancelPendingImport`/`countPostmanRequests`).
- **Symptom:** Picking a Postman JSON file or a Bruno folder immediately imported it — no chance to
  see how many requests it contained, or to rename the destination folder before anything was
  written. Since the target directory name was auto-derived from the collection's own name, a
  second import of a similarly-named collection could silently collide or need a manual rename
  cleanup afterward, and there was no way to catch a wrong-file pick before it landed on disk.
- **Fix:** Added a client-side review step between "file picked" and "written": picking a file now
  populates `pendingImport` state (`{ kind, sourceName, requestCount, targetDir }`) and renders a
  review screen showing the count (`countPostmanRequests()` recursively walks the parsed Postman
  JSON tree counting leaf `.request` items; Bruno shows a `.bru` file count) and an editable
  `targetDir` field, with a "back" button to cancel and re-pick. Nothing is written until "import N
  request(s)" is clicked, which calls the existing import API with the now-possibly-edited target.
  No backend/core changes — the importer already had everything needed; this only defers the call
  and computes a preview from data already in hand.
- **Verification:** In the real browser, used the newly-available `claude-in-chrome__file_upload`
  tool to inject a hand-crafted 2-request Postman collection directly into the hidden file input
  (bypassing the native OS file-picker, which can't be automated): confirmed the review screen
  showed "found 2 requests in Demo Collection", confirmed nothing existed on disk yet, edited the
  target folder name, confirmed the import, and confirmed the correct on-disk result.
- **Regression test:** [`e2e/import-review.spec.ts`](../../e2e/import-review.spec.ts) — builds a
  temp 2-request Postman JSON fixture, sets it on the file input via Playwright's
  `setInputFiles`, asserts the review screen's count text and that nothing is written to disk yet,
  edits the target field, confirms, and asserts the final on-disk state. **Failed on the pre-fix
  code** (`.modal-body` never contains "found 2 requests" — the old code wrote immediately and
  jumped straight to the success message instead), confirmed by stashing the fix and re-running.

## Verification

- Stashed both fixes (`App.tsx`, `FlowView.tsx`, `styles.css`, and moving `NewFolderModal.tsx`
  aside), rebuilt, and re-ran both new spec files: all 3 tests **failed** against the pre-fix code
  (2 timeouts on the missing modal, 1 assertion failure on the missing review text) — confirming
  the tests actually exercise the new behavior, not just something already true. Restored the fix
  and rebuilt.
- `pnpm typecheck` (full workspace, Turborepo) — 8/8 tasks pass.
- `pnpm test:e2e` — **43/43 passed** (40 pre-existing + 3 new), including all accessibility,
  security, and typography suites — no regressions.
- Manually tested both flows end-to-end in the live app in the user's own Chrome; cleaned up all
  test artifacts from `examples/blog` afterward and confirmed `git status --short examples/` is
  clean.

## Verdict

Both flows now match the guided-modal convention already established elsewhere in the app, and
import gained a safety net (preview + editable target, nothing written until confirmed) it never
had. No backend/core/CLI changes — scoped entirely to `packages/web`.
