# Editors: Web UI & VS Code

TruSpec is CLI-first, but two optional surfaces let you work with collections visually — a
local web UI and a VS Code extension. Both run requests **locally through the engine** (no
CORS, no cloud), so they behave identically to `truspec run`.

---

## Web UI

`truspec serve` opens a local web app for a collection. Requests execute **server-side**
through `@truspec/core`, so there are no browser CORS limits — the UI is just a front-end
over the same engine the CLI uses.

```bash
truspec serve --dir ./api      # opens http://localhost:4100
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

The web UI is read-and-run focused today; in-UI request *editing* is on the roadmap. For
authoring, edit the `.tspec.yaml` files directly (with [schema-backed
autocomplete](./file-format.md#editor-integration)) or use the VS Code extension below.

---

## VS Code extension

**TruSpec for VS Code** runs `.tspec.yaml` requests and checks OpenAPI drift & coverage
without leaving your editor. Requests execute in the extension host via `@truspec/core` —
no CORS, fully local.

Features:

- **CodeLens** on every `.tspec.yaml`: ▶ Run · Run collection · Drift · Coverage.
- **Commands** (⇧⌘P): *TruSpec: Run Request / Run Collection / Drift / Coverage*.
- Results render in a side panel — status, timing, assertions, plus drift and coverage
  views.
- The `truspec.environment` setting picks the environment (otherwise you're prompted).

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
- **[Spec sync](./spec-sync.md)** — the drift/coverage views both surfaces show.
