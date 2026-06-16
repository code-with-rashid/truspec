# @truspec/web

The web UI + local server for [TruSpec](https://github.com/code-with-rashid/truspec) — a local-first, spec-synced API client. Launched via `truspec serve`, it executes requests **server-side** (no CORS) through `@truspec/core` and serves a React front-end.

```bash
npm i -g truspec
truspec serve --dir ./api      # opens the UI at http://localhost:4100
```

Screens: a collection sidebar, a request view (run + assertions), a results panel, and a spec view (drift + coverage). Dark/light, keyboard-friendly, fonts self-hosted for offline use.

See the [main README](https://github.com/code-with-rashid/truspec#readme).

MIT
