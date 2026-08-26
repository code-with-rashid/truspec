# Desktop Wrapper Review — Round 1 (2026-08-26)

A pivot from this session's 29 rounds of `packages/web` UX refinement to territory none of them
touched: `packages/desktop`, the Tauri wrapper that turns the web UI into a native window with a
bundled Node sidecar.

## A rigor caveat, up front

Every prior round in this session followed the same cycle: implement → verify live in a real
browser → write a Playwright regression test → prove it fails on pre-fix code → full workspace
`pnpm typecheck` → full `pnpm test:e2e`. **None of that is available here.** This environment has
no Rust toolchain (`cargo`/`rustc` not found) — nothing in this round was compiled, let alone run.
`packages/desktop`'s own `pnpm typecheck` is a `node -e ""` no-op (see `package.json`), not a real
check. The repo does have a `.github/workflows/desktop.yml` CI job that builds the app on
Windows/macOS/Linux with a real Rust toolchain and would catch a genuine compile error — but that
hasn't run against this change yet, and I haven't seen it run. **Treat the two code changes below
as unverified — reviewed carefully against Tauri 2.11's documented API and Rust's standard library,
but not compiled or executed.**

## Findings (4 fixed, unverified; 1 left as a documented decision)

### 1. Fixed: the native window had no minimum size

- **Where:** [`packages/desktop/src-tauri/src/sidecar.rs`](../../packages/desktop/src-tauri/src/sidecar.rs)
  (`navigate_to`).
- **Symptom:** `WebviewWindowBuilder::new(...).inner_size(1200.0, 800.0)` sets the *initial* size
  but never calls `.min_inner_size(...)`. The native OS window can be resized arbitrarily small —
  well below the ~620px floor the web UI's own CSS was hardened down to in rounds 14-15 of the web
  UX pass (toolbar wrapping, workspace-grid internal scroll). Below that floor there's nothing left
  to gracefully degrade; the window becomes a mostly-empty, barely-scrollable sliver with no
  built-in way back except manually dragging the window larger again.
- **Fix:** Added `.min_inner_size(680.0, 480.0)` to the same builder chain — a floor comfortably
  above the CSS breakpoints already established, so the native window can never be shrunk into the
  "nothing useful is visible" zone those CSS passes couldn't fully rescue on their own.

### 2. Fixed: a deleted/moved/disconnected last-opened folder had no fallback

- **Where:** [`packages/desktop/src-tauri/src/sidecar.rs`](../../packages/desktop/src-tauri/src/sidecar.rs)
  (`open_collection_flow`), [`config.rs`](../../packages/desktop/src-tauri/src/config.rs)
  (`get_last_dir`, unchanged — the fix is entirely at the call site).
- **Symptom:** `get_last_dir` returns whatever path was persisted from the last session with no
  existence check, and `open_collection_flow` hands it straight to `start()`, which spawns the
  sidecar with `--dir <path>` unconditionally. If that folder was since deleted, renamed, or lived
  on a removable/network drive that's now disconnected, the app launches straight into a broken
  state with no picker offered — the only way out is already knowing "File > Open Collection…"
  exists in the menu bar.
- **Fix:** `open_collection_flow` now filters the persisted path through `Path::new(dir).is_dir()`
  before treating it as usable; a stale/missing directory is treated identically to "no persisted
  directory at all" (the existing `None` branch), which already correctly falls through to the
  folder picker.

### 3. Fixed: no native "Edit" menu

- **Where:** [`packages/desktop/src-tauri/src/menu.rs`](../../packages/desktop/src-tauri/src/menu.rs).
- **Symptom:** `menu.rs` built only a "File" submenu (New/Open Collection…, Quit). Tauri apps on
  macOS specifically need a native Edit menu with standard Cut/Copy/Paste/Undo/Redo/Select All
  items for the OS to route the corresponding `Cmd+C`/`Cmd+V`/etc. keyboard shortcuts into the
  webview at all — a well-documented Tauri/Electron-class gotcha, not specific to this codebase.
- **Fix:** Added an "Edit" submenu using `SubmenuBuilder`'s predefined-item convenience methods
  (`.undo() .redo() .cut() .copy() .paste() .select_all()`) — the same builder already used for
  the "File" menu, so no new API surface beyond methods on a type this file already calls.
  Deliberately avoided the lower-level `PredefinedMenuItem::*` constructors (which take an
  `Option<&str>` label override) since the zero-arg builder methods have less room to get a
  parameter wrong.

### 4. Fixed: no "About"/version info anywhere in the app

- **Where:** [`packages/desktop/src-tauri/src/menu.rs`](../../packages/desktop/src-tauri/src/menu.rs).
- **Symptom:** No menu item or in-app surface showed which version was installed — makes bug
  reports and support harder to triage ("which version are you on?" had no answer inside the app
  itself).
- **Fix:** Added a "Help" submenu with an "About TruSpec" item. Its handler shows a message dialog
  (`app.dialog().message(...).title("About TruSpec").show(...)`) with the app name and version
  pulled from `app.package_info().version` (Tauri's own build-time package metadata, already
  synced from `tauri.conf.json`'s `version: "0.8.1"` — nothing hand-duplicated). Chose a dialog
  over `PredefinedMenuItem::about` + `AboutMetadata` deliberately: the dialog plugin
  (`tauri_plugin_dialog`) and its callback-based `.show(|_| {})` shape are already proven working
  in this exact codebase (`sidecar.rs`'s folder picker uses the identical pattern), whereas
  `AboutMetadata`'s exact field/builder shape across Tauri 2.x point releases was the part of this
  finding I was least sure of from memory — reusing an already-working pattern instead of a new
  one I couldn't verify was the lower-risk choice.

### 5. Left as a documented decision, not touched: `tauri.conf.json`'s `security.csp` is `null`

- Tauri's `app.security.csp` setting injects a CSP into HTML served through the **`tauri://`
  asset protocol** (bundled frontend files). This app's window never uses that protocol — `main.rs`
  → `sidecar.rs::navigate_to` always opens `WebviewWindowBuilder::new(app, "main",
  WebviewUrl::External(url))` pointing at the sidecar's own `http://localhost:<port>`. Per my
  understanding of Tauri's docs, an externally-loaded URL like that is governed by *that server's*
  own HTTP response headers, not this config key — and the web UI's server already sets those
  (`X-Frame-Options: DENY`, a `frame-ancestors 'none'` CSP header, covered by `e2e/security.spec.ts`).
  If that understanding is right, `csp: null` here is inert either way and there's nothing to fix.
- I did **not** flip it to a non-null value despite that reasoning, for one concrete reason: it's
  the one change in this whole review where being wrong has a *silent, unrecoverable-without-a-
  compiler* failure mode. If Tauri's CSP injection turns out to apply more broadly than I believe,
  an over-strict policy (e.g. blocking inline styles Vite's production bundle may emit) would
  render a blank window with no console access in a packaged build, and I have no way to catch
  that before it reaches a user. The Edit-menu and About fixes above fail loud (a compile error CI
  will catch) if I got something wrong; this one wouldn't. That asymmetry, not the underlying
  question of whether it's a real gap, is why it's still untouched — worth a deliberate decision
  by someone who can build and click through the packaged app, not a guess from me.

## Verdict

Four small fixes applied and clearly marked unverified — two (window min-size, stale-folder
fallback) from the first pass, two more (Edit menu, About) from this one, all reviewed against
Tauri 2.11's documented API and reusing patterns already proven elsewhere in this same codebase
where possible. One finding (CSP) deliberately left untouched rather than guessed at, given its
uniquely silent failure mode. If you'd like all four compiled and confirmed, the desktop CI
workflow (`.github/workflows/desktop.yml`) or a local Rust toolchain would need to actually run
against this branch.
