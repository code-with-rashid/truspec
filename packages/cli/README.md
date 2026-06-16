# truspec

The CLI for [TruSpec](https://github.com/code-with-rashid/truspec) — a local-first, spec-synced, agent-native API client. Your collection is plain text your agent and CI run, failing the build when code drifts from your OpenAPI spec. Offline, no account.

```bash
npm i -g truspec

truspec run ./api --env local                      # run requests + assertions (CI exit codes)
truspec drift    --spec openapi.yaml ./api          # fail CI on collection ↔ spec drift
truspec coverage --spec openapi.yaml ./api --min 80 # gate on tested-operation coverage
truspec mock     --spec openapi.yaml                # offline mock server from your spec
truspec import postman ./postman.json --out ./api   # migrate existing collections
```

Every command supports `--json`. See the [main README](https://github.com/code-with-rashid/truspec#readme).

MIT
