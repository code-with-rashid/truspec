# @truspec/web

The web UI + local server for [TruSpec](https://github.com/code-with-rashid/truspec) — a local-first, spec-synced API client. Launched via `truspec serve`, it executes requests **server-side** (no CORS) through `@truspec/core` and serves a React front-end.

```bash
npm i -g truspec
truspec serve --dir ./api      # opens the UI at http://localhost:4100
```

Screens: a collection sidebar, a request view (run + assertions), a results panel, and a spec view (drift + coverage). Dark/light, keyboard-friendly, fonts self-hosted for offline use.

## Documentation

- **[Editors guide: Web UI & VS Code](https://code-with-rashid.github.io/truspec/editors)**.
- **[Full documentation](https://code-with-rashid.github.io/truspec/)** — concepts, file format, CLI, spec sync, and more.

See the [main README](https://github.com/code-with-rashid/truspec#readme).

MIT
