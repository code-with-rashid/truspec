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

## Findings (2 fixed, unverified; 3 reported only)

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

### 3-5. Reported, not fixed — higher API-surface risk without a way to compile-check

- **No "Edit" menu.** `menu.rs` builds only a "File" submenu (New/Open Collection…, Quit). Tauri
  apps on macOS specifically need a native Edit menu with standard Cut/Copy/Paste/Undo/Redo/Select
  All items (Tauri's `PredefinedMenuItem::copy`/`::cut`/`::paste`/etc.) for the OS to route the
  corresponding `Cmd+C`/`Cmd+V`/etc. keyboard shortcuts into the webview at all — a well-documented
  Tauri/Electron-class gotcha, not specific to this codebase. Worth adding, but building a second
  submenu with several `PredefinedMenuItem` calls has more surface area to get subtly wrong (exact
  item constructors, accelerator defaults) than the two single-line fixes above, and I have no way
  to catch a mistake before it reaches a real build. Left as a recommendation rather than a
  patch — happy to implement given either explicit sign-off to ship unverified Rust, or a way to
  compile-check it first.
- **No "About"/version info anywhere in the app.** There's no menu item or in-app surface showing
  which version is installed — makes bug reports and support harder to triage ("which version are
  you on?" has no answer inside the app itself).
- **`tauri.conf.json`'s `security.csp` is explicitly `null`.** Disables Tauri's own webview CSP
  injection entirely. Likely intentional and probably fine in practice — the web UI already carries
  its own HTTP-level protections (`X-Frame-Options: DENY`, a `frame-ancestors 'none'` CSP header
  set server-side, and the XSS-escaping this session's `e2e/security.spec.ts` already covers) — but
  flagging it since a `null` CSP is a real reduction in defense-in-depth for the webview layer
  specifically, and it's not obvious from the surrounding code whether that was a deliberate
  trade-off or an unset default. Not touched.

## Verdict

Two small, standard-library/well-documented-API fixes applied and clearly marked unverified;
three further findings reported for the user's own judgment rather than risking unverifiable Rust
changes stacking up. If you'd like these compiled and confirmed (or the Edit-menu fix attempted),
the desktop CI workflow (`.github/workflows/desktop.yml`) or a local Rust toolchain would need to
actually run against this branch.
