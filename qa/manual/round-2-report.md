# Manual E2E QA — Round 2 (2026-08-23)

Continuing from [round 1](round-1-report.md), which covered core workspace CRUD, the editor, mock
server, run-all, Flow view, Spec view, and the command palette. This round targets what round 1
flagged as untested: Postman/Bruno import (via the Flow view's "+ import collection"), the folder
settings modal (inherited headers/auth), resizable panels, and tab lifecycle (unsaved-changes
handling) — plus whatever else turned up along the way.

Setup unchanged from round 1: `truspec serve --dir examples/blog`, real Chromium via the Browser
pane, mock server for live responses where needed.

## Findings

### 1. Closing a tab with unsaved changes silently discarded them — no warning — FIXED

- **Where:** [App.tsx](../../packages/web/src/App.tsx) (`requestCloseTab`, new `beforeunload` guard)
- **Symptom:** Open a request, edit it inline (e.g. add a header) without saving — the tab strip
  correctly shows a "●" dirty dot (`title="unsaved changes"`). Click the tab's own ✕ close button:
  the tab closes immediately, the edit is gone, no confirmation, no undo. Same risk on closing/
  reloading the browser tab itself — no `beforeunload` guard existed at all.
- **Root cause:** `closeTab` unconditionally removed the tab from state; nothing checked `dirty`
  before doing so, and no `beforeunload` listener was ever registered.
- **Fix:** added `requestCloseTab`, wired as the `TabStrip`'s `onClose` — if the tab is dirty it
  opens a `ConfirmModal` ("discard unsaved changes?"), reusing the same confirm pattern already
  used for delete; only on confirm does `closeTab` actually run. Also added a `beforeunload`
  listener (registered only while `tabs.some(t => t.dirty)`) so closing/reloading the whole page
  is guarded the standard way too, closing the same class of silent-data-loss gap at its other
  entry point.
- **Verification:** `pnpm --filter @truspec/web typecheck` clean; live re-test (dirty edit → close
  → confirm dialog appears → cancel leaves the tab open and still dirty → close again → discard
  actually closes it and the file on disk is confirmed untouched either way). Full e2e suite green.
- **Regression test:** [e2e/editor.spec.ts](../../e2e/editor.spec.ts) → "closing a tab with unsaved
  changes asks for confirmation instead of discarding silently" — confirmed it fails on the pre-fix
  code (`git stash` + rebuild: the confirm modal never appears) and passes after.

## Investigated, no bug found

- **My own test-script mistake, not an app bug:** while probing the folder settings modal
  (headers/auth inherited by requests in a folder), I initially grabbed the wrong `<input>` when
  simulating a bearer-token entry (the modal has an unlabeled-in-`innerText` "folder name" field
  *before* the auth section that I didn't notice via `innerText` alone, since `<input>` values
  never render into `innerText`). That typed `{{token}}` into the folder's `name:` field instead of
  the auth token, producing a corrupted `folder.tspec.yaml`. Checked whether this had any real
  effect: it didn't — `FolderNode.name` in [`tree.ts`](../../packages/web/src/tree.ts) is always
  derived from the directory's path segment, never from `folder.tspec.yaml`'s `name:` field, so a
  garbage folder-name value is inert and invisible in the UI. Redid the test correctly (targeting
  the token input by its actual `.kv-input` class) and confirmed folder-level auth inheritance
  works end-to-end: a request with no auth of its own picked up the folder's `bearer {{token}}` and
  correctly reported `Unresolved variables: {{token}}` when sent (the variable isn't declared in
  the `local` environment) — proving the header really is being merged in at resolve time, not just
  displayed as configured.
- **Postman collection import** (`+ import collection` → `.json` file) — simulated a real
  `File`/`DataTransfer` drop into the hidden file input (no OS file-picker available in this
  harness). A collection with nested folders, a root-level bearer auth, a raw-JSON POST body, and
  query params imported perfectly: correct folder nesting, correct `folder.tspec.yaml` auth
  inheritance at the collection root, correct query-param extraction from the URL, correct
  `body.type: json` conversion from the raw string. Sidebar reflected the new folder immediately.
- **Bruno import** (folder of `.bru` files, `webkitdirectory` input) — same technique. A `.bru`
  file with `meta`/`get`/`headers`/`query`/`auth:bearer`/`assert` blocks converted correctly,
  including the `assert` block → `status equals 200` + `jsonpath $.id exists: true` assertions.
- **Resizable panels** (sidebar and spec-intelligence rail drag handles) — dispatched a real
  `pointerdown`/`pointermove`/`pointerup` sequence (matching what `usePanelWidth`'s handler
  actually listens for) with waits between each so React could commit state between them. Sidebar
  resized correctly and persisted to `localStorage`; dragging far past the max correctly clamped
  to `MAX_SIDEBAR` (480px) rather than growing unbounded or breaking layout.
- Two more instances of the same "batching artifact" methodology note from round 1: right-clicking
  a folder for its context menu, and a drag-and-drop *move* dispatched without waits between the
  drag events, both looked broken on a synchronous JS-driven read and both turned out to work fine
  once queried after a real tick (or, for drag-and-drop, once the event sequence had waits between
  steps matching how a real drag actually unfolds). Recorded here so a future round doesn't
  re-chase the same false lead.

## Known gap (not testable in this environment)

- **The Tauri desktop shell itself** (`packages/desktop`) is, per its own description, "a native
  window over the truspec serve web UI" — no separate frontend code of its own beyond a
  `prepare-sidecar` script and the Rust/Tauri shell in `src-tauri`. This machine has no Rust/cargo
  toolchain (`Get-Command cargo`/`rustc` — not found), and installing one is out of scope for a
  manual UI QA pass. Everything the desktop app *displays* is the same `@truspec/web` UI already
  driven hard across both rounds, so the highest-value remaining risk is specifically in the native
  shell layer (the "File > New Collection…" menu item, window chrome, the sidecar process
  lifecycle) — none of which is reachable without a native build. Flagging honestly rather than
  claiming coverage that wasn't exercised.

## Verification

- `pnpm --filter @truspec/web typecheck` — clean.
- `pnpm test:e2e` (Playwright, real Chromium) — **16/16 passed** (was 15 at the end of round 1;
  +1 new regression test), no regressions.
- All scratch artifacts from this round's manual exploration (a `folder.tspec.yaml` corrupted by
  my own selector mistake, then a correctly-configured one, an imported `sample-api/` Postman
  folder, an imported `my-bruno-collection/` folder) were deleted; `examples/blog` verified clean
  via `git status` before wrapping up. `localStorage` panel-width values reset to defaults.

## Verdict

1 real bug found and fixed this round (silent data loss on tab close), with a regression test that
fails pre-fix and passes post-fix. Broad coverage added on top of round 1: both import paths
(Postman and Bruno), folder-level header/auth inheritance verified end-to-end through actual
request resolution, and resizable panels. The one remaining gap (the native Tauri shell) is a
tooling limitation of this environment, not a decision to skip it. Continuing to round 3 for a
confirmation pass over both rounds' fixes plus any UI edges not yet touched (light theme visual
pass, keyboard-only navigation through the whole workspace, spec-view edge cases like an
unresolvable/malformed spec file).
