# TruSpec for VS Code

Run `.tspec.yaml` requests and check OpenAPI **drift & coverage** without leaving your editor. Requests execute in the extension host via [`@truspec/core`](https://www.npmjs.com/package/@truspec/core) — no CORS, fully local.

- **CodeLens** on every `.tspec.yaml`: ▶ Run · Run collection · Drift · Coverage
- **Commands** (⇧⌘P): *TruSpec: Run Request / Run Collection / Drift / Coverage*
- Results render in a side panel (status, timing, assertions; drift + coverage views).
- `truspec.environment` setting picks the env (otherwise you're prompted).

## Develop

```bash
pnpm --filter truspec-vscode build
```

Then press **F5** in the repo (the *Run TruSpec Extension* launch config) to open an Extension Development Host on `examples/blog`, open a `.tspec.yaml`, and click the **▶ Run** CodeLens.

Part of [TruSpec](https://github.com/code-with-rashid/truspec). MIT.
