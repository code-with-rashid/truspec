# Manual E2E QA — Round 1 (2026-08-23)

This is a fresh manual-QA loop (`qa/manual/round-*` reports), distinct from the adversarial
fuzzing/security campaigns already logged in [`QA_LOG.md`](../../QA_LOG.md) (10 campaigns, ending
2026-06-23). Since that log was written, the web UI got a full "Bruno-parity" redesign — inline
editing, tabs, a real collection tree, drag/drop, a Flow view, a command palette, contract
validation, resizable panels, Postman/Bruno import — and the desktop app gained a native "New
Collection" menu. None of that surface had been exercised by hand yet, so this round targets it:
the `@truspec/web` UI (which the Tauri desktop app just wraps via `truspec serve`), driven live in
a real browser against the `examples/blog` collection with its local mock server for real
responses.

Setup: `pnpm install`, `pnpm build` (workspace was un-built), installed Playwright's Chromium.
Ran via `truspec serve --dir examples/blog` (built client, matching real usage — not `vite dev`,
to avoid a same-origin/CSRF proxy mismatch with the app's own Origin-checking guard).

## Findings

### 1. Renaming a request in the sidebar didn't update its displayed name — FIXED

- **Where:** [App.tsx](../../packages/web/src/App.tsx) (`doRename`/`submitRename`)
- **Symptom:** Click the ✎ "rename request" action on a sidebar row, type a new name, hit Enter —
  the sidebar row is completely unchanged. The rename input is pre-filled with the file's slug
  (e.g. `get-post`), not the currently-displayed name (`Get post`), which already looks stale the
  moment the box opens; after submitting, the sidebar (which renders the request's `name:` YAML
  field) still shows the old name, making the action look like it silently failed. Verified live:
  the file *was* actually renamed on disk (`git mv`-style), just not its `name:` content field.
- **Root cause:** `doRename` called only `renamePath` (a pure filesystem rename via `/api/rename`)
  and never touched the request's `name:` field. `doMove` (drag/drop into another folder) also
  routes through `doRename`, so any fix had to leave a plain move untouched.
- **Fix:** `submitRename` now passes the typed value through as an explicit `displayName`
  parameter; `doRename`, only when invoked with one (i.e. never for `doMove`, and never for
  folders — folders have no separate name field), re-fetches the renamed request and, if its
  `name` differs from the typed value, saves it with `name` updated to match — stripping the
  editor-only `raw` field first (an first attempt at this fix forgot that step and got rejected by
  the schema's `.strict()` check on unknown keys; caught immediately by re-running the new e2e test
  and reading the actual `/api/request/object` response body). Also patches the field into any
  already-open tab's cached `detail`/`draft` so an open tab's header updates too, not just the
  sidebar.
- **Verification:** `pnpm --filter @truspec/web typecheck` clean; live re-test (renamed "Get post"
  → "Fetch a single post", sidebar updated instantly, file content confirmed on disk, request still
  opened/sent correctly with a space-containing filename). Full e2e suite green.
- **Regression test:** [e2e/editor.spec.ts](../../e2e/editor.spec.ts) → "renaming a request in the
  sidebar updates its displayed name, not just the file" — confirmed it fails on the pre-fix code
  (`git stash` + rebuild) and passes after.

### 2. Command palette's "↵ open" hint didn't work — Enter did nothing — FIXED

- **Where:** [CommandPalette.tsx](../../packages/web/src/components/CommandPalette.tsx)
- **Symptom:** Open the palette (⌘/Ctrl+K), type to filter down to one result, press Enter — nothing
  happens. The palette footer explicitly advertises "↵ open" as a keyboard affordance, but the only
  way to actually open a result was clicking it with the mouse.
- **Root cause:** the `.palette-input` had `onChange` wired but no `onKeyDown` handler at all — no
  code path called `onSelect` for any keyboard event. (Escape-to-close *is* wired, just at the
  `App.tsx` level, which made the missing Enter handler easy to miss.)
- **Fix:** added `onKeyDown` on the input — Enter opens `items[0]` (the top/first match), mirroring
  the existing `.palette-item` `onClick={() => onSelect(r.path)}` behavior.
- **Verification:** `pnpm --filter @truspec/web typecheck` clean; live re-test (⌘K → type "list" →
  Enter → "List posts" opened as a tab). Full e2e suite green.
- **Regression test:** [e2e/editor.spec.ts](../../e2e/editor.spec.ts) → "command palette: Enter
  opens the top match (not just a mouse click)" — confirmed fails pre-fix, passes after.

### 3. `@truspec/desktop`'s `typecheck` script was Unix-only — FIXED

- **Where:** [packages/desktop/package.json](../../packages/desktop/package.json)
- **Symptom:** found while re-verifying the fixes above with a full-workspace `pnpm typecheck` on
  this Windows machine: `@truspec/desktop#typecheck` failed with `'true' is not recognized as an
  internal or external command`. Not related to my UI changes — `git stash` on unmodified `main`
  reproduces the same failure.
- **Root cause:** the script was `"typecheck": "true"`, using the POSIX no-op command `true` as a
  stand-in for "this package has no TypeScript to check" (it's a thin Tauri shell over
  `@truspec/web`). `true` isn't a real command on Windows, so `pnpm typecheck` fails on every
  Windows dev machine / CI runner, even though there's nothing actually wrong.
- **Fix:** `"typecheck": "node -e \"\""` — a genuine cross-platform no-op, since Node is guaranteed
  present in this toolchain.
- **Verification:** `pnpm typecheck` now reports 8/8 tasks successful on Windows (was 7/8).

## Investigated, no bug found

- **Sidebar folder collapse/expand, tab-strip close, theme toggle** all *looked* broken on the
  first read after a synchronous `element.click()` via injected JS — re-querying the DOM
  immediately in the same script tick raced React 18's batched re-render. Re-checking a moment
  later (or via Playwright's own auto-waiting) showed each one had worked correctly. Not real bugs
  — an artifact of driving the app through raw JS rather than a real user's paced interaction
  (consistent with this skill's own methodology note about stray/rushed automated input).
- **Drag-and-drop move (request → another folder)** initially looked broken when I dispatched a
  `dragstart`/`dragenter`/`dragover`/`drop`/`dragend` sequence with no delay between events —
  again a batching artifact (the `dragging` state set by `dragstart` hadn't been committed by the
  time `drop` fired in the same synchronous script). Re-ran with real waits between each event:
  the move worked correctly and moved the right file to the right folder.
- **Rename box producing a filename with spaces/capitals verbatim** (e.g. `Fetch a single
  post.tspec.yaml`) — the request still opened, sent, and kept its spec link and assertions with
  a space-containing filename. This matches the existing pattern (the box is free text; `duplicate`
  and Postman/Bruno import already handle slugification separately for their own generated names)
  and isn't something this action has ever slugified, so left as-is rather than invented behavior.
- **Environment create/edit/delete** (variables, secret names, delete-with-confirm) — all wrote/
  removed the right `environments/<name>.env.yaml` file with correct content.
- **New folder, new request, duplicate, delete (with confirm modal), context menu** — all
  correct; files land in the right place with the right content, confirm modal actually gates the
  delete.
- **Raw-YAML editor validation** — an invalid save (bad enum, wrong type, unknown key) shows the
  exact Zod error inline and leaves the original file byte-for-byte untouched.
- **Mock server** — start/stop works; requests against it return real example responses; contract
  (`schema`) assertions pass against it; the mock route list correctly reflects tested/untested
  spec operations.
- **Run-all / Flow view** — running the whole collection updates every sidebar status dot; the
  Flow view's step list, edges, and per-step detail panel (captures/consumes/assertions) all
  matched the actual run results.
- **Spec view** — coverage % and drift (untracked/stale/changed) matched the real state of the
  `examples/blog` collection vs. its `openapi.yaml`.
- **Missing-variable error UX** — selecting environment `(none)` and sending a request that needs
  `{{baseUrl}}`/`{{postId}}` shows a clear "Unresolved variables: …" message instead of a raw
  `fetch failed`.
- **Export as Postman collection** — `POST /api/export/postman` succeeds, no console errors.

## Verification

- `pnpm --filter @truspec/web typecheck` — clean, both fixes.
- `pnpm typecheck` (full workspace) — **8/8** (was 7/8 before the desktop fix).
- `pnpm build` (full workspace) — 5/5.
- `pnpm test:e2e` (Playwright, real Chromium) — **15/15 passed** (was 13; +2 new regression tests),
  including the pre-existing a11y/XSS/CSRF/BUG-O suite — no regressions.
- `pnpm test` (vitest unit suite) — 346/352 passed; the 6 failures are pre-existing on unmodified
  `main` (Windows-only: `EPERM` creating symlinks without elevated privileges/Developer Mode in
  3 `core` tests, and a Unix-path-separator-only regex in 2 `cli/serve` tests) — confirmed via
  `git stash` on a clean checkout, unrelated to anything touched this round. Not fixed (out of
  scope: pre-existing, environment-specific, not part of the UI surface this round targeted).
- All test/example scratch files created during manual exploration (`qa-round1.tspec.yaml`,
  a duplicated/renamed copy, a `staging` environment, a `users` folder, a drag-moved request) were
  deleted and `examples/blog` verified clean (`git status`) before wrapping up.

## Verdict

2 real UI bugs found and fixed with regression tests (both in the newly-redesigned web UI: sidebar
rename not reflecting in the display, and the command palette's advertised Enter-to-open not being
wired up), plus one incidental cross-platform build-script bug fixed along the way. Broad coverage
this round: full workspace CRUD (create/rename/duplicate/delete/move for both requests and
folders), the raw-YAML editor and its validation, environments, the mock server and contract
assertions, run-all, the Flow view, the Spec/coverage/drift view, the command palette, and error
messaging for missing variables. Continuing to round 2 to cover what's left: Postman/Bruno import
via the Flow view's "+ import collection", folder settings modal, resizable-panel dragging, and
the desktop (Tauri) shell specifically.
