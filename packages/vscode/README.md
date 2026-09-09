# TruSpec for VS Code

Run `.tspec.yaml` requests and check OpenAPI **drift & coverage** without leaving your editor. Requests execute in the extension host via [`@truspec/core`](https://www.npmjs.com/package/@truspec/core) — no CORS, fully local.

- **CodeLens** on every request `.tspec.yaml`: ▶ Run · Run folder · Drift · Coverage
  (a `folder.tspec.yaml` is configuration, not a request, so it gets the last three only).
  **Run folder** runs the directory the open file is in, not the whole repository.
- **Commands** (⇧⌘P): *TruSpec: Run Request / Run Folder / Drift / Coverage*
- Results render in a side panel (status, timing, assertions; drift + coverage views).
- `truspec.environment` setting picks the env (otherwise you're prompted).

## Develop

```bash
pnpm --filter truspec-vscode build
```

Then press **F5** in the repo (the *Run TruSpec Extension* launch config) to open an Extension Development Host on `examples/blog`, open a `.tspec.yaml`, and click the **▶ Run** CodeLens.

## Documentation

- **[Editors guide: Web UI & VS Code](https://code-with-rashid.github.io/truspec/editors)**.
- **[Full documentation](https://code-with-rashid.github.io/truspec/)** — concepts, file format, CLI, spec sync, and more.

Part of [TruSpec](https://github.com/code-with-rashid/truspec). MIT.
