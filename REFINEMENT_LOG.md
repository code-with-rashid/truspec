# TruSpec refinement log

A running record of a 100-iteration refinement campaign: competitive research, feature work,
UI/UX polish, and stabilization. Each iteration is a self-contained, tested, committed change.

## Competitive baseline (research, Sept 2026)

| Capability | Postman | Bruno | Insomnia | Hoppscotch | TruSpec (before) |
|---|:--:|:--:|:--:|:--:|:--:|
| Plain-text collections in git | ✗ | ✓ | partial | ✗ | ✓ |
| Fully offline, no account | ✗ | ✓ | ✗ | ✗ | ✓ |
| OpenAPI drift gate in CI | ✗ | basic | ✗ | ✗ | ✓ |
| OpenAPI coverage report | ✗ | ✗ | ✗ | ✗ | ✓ |
| Response contract validation | partial | ✗ | ✗ | ✗ | ✓ |
| Local mock server | cloud | ✗ | ✗ | ✗ | ✓ |
| First-party MCP server | bolted-on | community | ✗ | ✗ | ✓ |
| **Code generation (many langs)** | ✓ 30+ | ✓ 35+ | ✓ | ✓ | **✗ (curl only, UI-only)** |
| **curl / HAR / Insomnia / OpenAPI import** | ✓ | ✓ | ✓ | ✓ | **✗ (postman + bruno only)** |
| **OAuth2 / digest / AWS SigV4 auth** | ✓ | ✓ | ✓ | partial | **✗** |
| **Cookie jar** | ✓ | ✓ | ✓ | ✓ | **✗** |
| **Multipart / file upload** | ✓ | ✓ | ✓ | ✓ | **✗** |
| **Data-driven runs (CSV/JSON)** | ✓ | ✓ | ✗ | ✗ | **✗** |
| **JUnit / HTML CI reports** | ✓ (newman) | ✓ | ✗ | ✗ | **✗** |
| **Proxy / TLS / client certs** | ✓ | ✓ | ✓ | ✗ | **✗** |
| **Retries / redirect policy** | ✓ | ✓ | ✓ | ✓ | **✗** |
| **SSE / streaming** | ✓ | ✓ | ✓ | ✓ | **✗** |

Gaps above drive the roadmap below. TruSpec's differentiators (spec-sync, offline, agent-native)
stay first-class; parity work must not compromise them.

## Roadmap themes

- **A. Engine + format parity** — codegen, importers, auth methods, bodies, transport options.
- **B. CLI / CI ergonomics** — reporters, selection, data-driven runs, scaffolding, lint.
- **C. Web + desktop UI/UX** — response viewing, discoverability, keyboard, a11y, resilience.
- **D. Stability + quality** — tests, fuzzing, perf, docs, release hygiene.

## Iterations

