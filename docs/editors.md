# Editors: Web UI, Desktop app & VS Code

TruSpec is CLI-first, but optional surfaces let you work with collections visually — a
local web UI (also installable as a native desktop app) and a VS Code extension. All of
them run requests **locally through the engine** (no CORS, no cloud), so they behave
identically to `truspec run`.

---

## Web UI

`truspec serve` opens a local web app for a collection. Requests execute **server-side**
through `@truspec/core`, so there are no browser CORS limits — the UI is just a front-end
over the same engine the CLI uses.

```bash
truspec serve ./api           # opens http://localhost:4100
```

| Flag | Alias | Default | Description |
|---|---|---|---|
| `--dir <collection>` | `-d` | `.` | Collection directory to serve. |
| `--port <n>` | `-p` | `4100` | Port. |

**Screens:**

- A **collection sidebar** listing your requests.
- A **request view** to run a request and see its assertions.
- A **results panel** with status, timing, and assertion outcomes.
- A **spec view** showing [drift and coverage](./spec-sync.md).

It's dark/light aware, keyboard-friendly, and self-hosts its fonts so it works fully
offline.

> The web UI is bundled when you install `truspec` from npm. From a source checkout, build
> it first with `pnpm --filter @truspec/web build`; otherwise `truspec serve` will tell you
> it isn't available.

**Editing.** Every field of a request is editable in place — name, method, URL, headers, query,
body, auth, assertions, `capture`, `order`, `tags`, transport `options`, description and scripts —
and there is a raw-YAML editor for anything you would rather type. Saves go through the same schema
validation as every other write, so the UI cannot produce a file the CLI would reject. You can also
edit the `.tspec.yaml` files directly (with [schema-backed
autocomplete](./file-format.md#editor-integration)) or use the VS Code extension below; the files
are the source of truth either way.

If a file changes on disk while you have it open — an agent editing it through the [MCP
server](./mcp.md), a `git pull`, your own editor — a save is **refused rather than silently
overwriting it**. The UI says the file changed and offers both ways out: reload to take what is on
disk (discarding your unsaved edits to that request), or overwrite it with what is in the tab. Your
repo is the source of truth, and more than one thing writes to it.

`tags` shown next to the request's name are the ones `truspec run --tag <name>` selects on, so the
subset your CI runs is visible in the client you author in. Transport `options` (timeout, retries,
retry delay, redirect following) sit below the description.

### Flow view

Click **Flow** in the nav to see a directory's requests laid out in run order, with
`capture -> consume` dependency edges drawn between them — so the chaining built from
`order` + `capture` + `{{var}}` interpolation (see [Chaining with
`capture`](./file-format.md#chaining-with-capture)) is visible instead of only readable
file-by-file. Each edge is colored by whether the last run actually produced that value
(unrun / ok / broken). Click a step to see its assertions, captures, and resolved values,
or click **Run flow** to execute the whole chain in place. You can also import a Postman
collection or a Bruno folder directly from this view.

---

## Desktop app

**TruSpec Desktop** wraps the same web UI in an installable native window (built with
[Tauri](https://tauri.app)) — no Node install required, and no separate logic from the
CLI/web server underneath.

[**Download the latest installer →**](https://github.com/code-with-rashid/truspec/releases/latest)

- **Windows** — `.exe` (NSIS) or `.msi`
- **macOS** — `.dmg` (Apple Silicon; runs on Intel Macs too, under Rosetta 2)
- **Linux** — `.AppImage`, `.deb`, or `.rpm`

These are **unsigned** builds for now (no code-signing cert or Apple notarization yet), so
your OS will warn on first launch:

- **Windows**: SmartScreen shows "unknown publisher" — click **More info → Run anyway**.
- **macOS**: Gatekeeper quarantines the download — run `xattr -cr /Applications/TruSpec.app`
  once, then open it.
- **Linux**: no equivalent warning.

On first launch the app asks you to pick a collection directory (remembered for next time),
spawns the same server `truspec serve` uses as a background process, and opens a native
window pointed at it — closing the window shuts that process down cleanly.

---

## VS Code extension

**TruSpec for VS Code** runs `.tspec.yaml` requests and checks OpenAPI drift & coverage
without leaving your editor. Requests execute in the extension host via `@truspec/core` —
no CORS, fully local.

Features:

- **CodeLens** on every request `.tspec.yaml`: ▶ Run · Run folder · Drift · Coverage
  (a `folder.tspec.yaml` is configuration, not a request, so it gets the last three only).
  **Run folder** runs the directory the open file is in — not the whole repository, which is
  what the workspace root usually is once `truspec init` has put `environments/` there.
- **Commands** (⇧⌘P): *TruSpec: Run Request / Run Folder / Drift / Coverage*.
- Results render in a side panel — status, timing, assertions, plus drift and coverage
  views.
- The `truspec.environment` setting picks the environment (otherwise you're prompted).
- Drift and coverage find a spec named `*openapi*` or `*swagger*` (`.yaml`, `.yml`, `.json`).

> The extension is **pre-release**; it isn't on the Marketplace yet. To run it from a source
> checkout: `pnpm --filter truspec-vscode build`, then press **F5** in the repo (the *Run
> TruSpec Extension* launch config) to open an Extension Development Host on
> `examples/blog`, open a `.tspec.yaml`, and click the **▶ Run** CodeLens.

---

## Schema-backed editing in any editor

You don't need an extension to get autocomplete and validation while editing files — point
your editor's YAML language server at the [published JSON
Schemas](./file-format.md#editor-integration):

```jsonc
// .vscode/settings.json
{
  "yaml.schemas": {
    "./node_modules/@truspec/core/schema/request.schema.json": "*.tspec.yaml",
    "./node_modules/@truspec/core/schema/environment.schema.json": "environments/*.env.yaml"
  }
}
```

This works with the Red Hat YAML extension in VS Code and any editor backed by the YAML
language server.

---

## See also

- **[CLI reference → serve](./cli.md#serve)**
- **[File format → Editor integration](./file-format.md#editor-integration)**
- **[Spec sync](./spec-sync.md)** — the drift/coverage views both surfaces show, and the
  chaining the Flow view visualizes.
