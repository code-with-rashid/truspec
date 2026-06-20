# @truspec/core

The engine behind [TruSpec](https://github.com/code-with-rashid/truspec) — a local-first, spec-synced, agent-native API client.

Subpath modules: `format`, `runner`, `workspace`, `spec`, `importers`, `mock`.

```ts
import { parse } from "@truspec/core/format";
import { runRequest } from "@truspec/core/runner";
import { driftReport, coverageReport } from "@truspec/core/spec";
import { startMockServer } from "@truspec/core/mock";
```

## Documentation

- **[Programmatic API reference](https://code-with-rashid.github.io/truspec/api)** — every `@truspec/core` subpath, function, and type.
- **[Full documentation](https://code-with-rashid.github.io/truspec/)** — concepts, file format, CLI, spec sync, and more.

See the [main README](https://github.com/code-with-rashid/truspec#readme) for the full picture.

MIT
