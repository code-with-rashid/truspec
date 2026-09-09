# Mock server

`truspec mock` starts a local HTTP server that serves generated responses from an OpenAPI
spec. It's fully offline — no cloud, no account — so you can develop and test against a
realistic API surface before the real one exists, or in CI where the real one isn't
reachable.

---

## Quick start

```bash
truspec mock openapi.yaml
# Mock server on http://127.0.0.1:4000 — 4 route(s). Press Ctrl+C to stop.
```

Point your collection's `baseUrl` at it and run:

```bash
truspec run ./api --env local      # with environments/local.env.yaml → baseUrl: http://localhost:4000
```

The server generates a response for each operation in the spec from its schema/examples.
A path the spec doesn't define returns `404`. A path it does define, asked with a method it
doesn't, returns `405` with an `Allow` header — so a wrong method reads as a wrong method, not
as a wrong URL. `HEAD` is served from the matching `GET` operation (same status and headers, no
body), which specs rarely declare but clients routinely ask for.

---

## Options

```
truspec mock <openapi> [--port <n>] [--delay <ms>] [--validate]
```

| Flag | Alias | Default | Description |
|---|---|---|---|
| `<openapi>` | | — | **Required.** Path to the OpenAPI document (YAML or JSON). Also accepted as `--spec` / `-s`. |
| `--port <n>` | `-p` | `4000` | Port to listen on. |
| `--delay <ms>` | | `0` | Artificial response latency, applied to every response. |
| `--validate` | | off | Validate incoming requests against the spec; respond `400` on mismatch. |

The server binds to `127.0.0.1` and runs until you interrupt it (Ctrl+C).

---

## Simulating latency

`--delay` adds a fixed delay before every response — handy for testing timeouts, spinners,
and [`duration` assertions](./file-format.md#assertions):

```bash
truspec mock openapi.yaml --delay 250
```

A request with `{ type: duration, ltMs: 200 }` will now fail against this mock, letting you
verify your timing expectations deterministically.

---

## Request validation

By default the mock is permissive — it returns a generated response for any path that
matches an operation. Add `--validate` to make it enforce the contract: requests that
violate the spec (e.g. a missing required parameter) get a `400` instead of a happy-path
response.

```bash
truspec mock openapi.yaml --validate
```

It checks three things: required query parameters are present, a required request body was
sent, and — for a JSON body — that the body **satisfies the schema its operation declares**.
The 400 names every field that violates it:

```json
{
  "error": "Request body does not satisfy the spec",
  "violations": [
    { "path": "/name", "message": "expected string, got number" },
    { "path": "/priceCents", "message": "expected integer, got string" }
  ]
}
```

A body that is not valid JSON gets `Request body is not valid JSON`; a non-JSON media type
(form, multipart) is passed through, since there is no JSON Schema to check it against.

This is useful for confirming your *client* sends spec-compliant requests, not just that it
handles spec-compliant responses.

---

## Typical uses

- **Local development** — front-end and integration work against a stable, offline API.
- **CI** — run your collection against the mock so tests don't depend on a deployed
  environment:

  ```bash
  truspec mock openapi.yaml &
  truspec run ./api --env ci
  ```

- **Contract confidence** — combine the mock with [`drift --live`](./spec-sync.md#probing-a-live-api---live)
  pointed at the mock to sanity-check the spec itself.

---

## From an AI agent

Agents can start and stop the mock over MCP with the
[`truspec_mock_start`](./mcp.md#tools) and `truspec_mock_stop` tools — start a mock,
run a collection against it, then tear it down, all without leaving the agent loop. When no
port is specified over MCP, an ephemeral free port is chosen and returned.

---

## Programmatic use

The mock is part of `@truspec/core`:

```ts
import { startMockServer } from "@truspec/core/mock";
import { readFileSync } from "node:fs";

const handle = await startMockServer(readFileSync("openapi.yaml", "utf8"), {
  port: 4000,        // 0 (or omit) picks a free port
  delayMs: 100,
  validate: true,
});

console.log(handle.url);     // http://127.0.0.1:4000
console.log(handle.routes);  // number of routes served
await handle.close();        // shut it down
```

See [Programmatic API → mock](./api.md#mock--local-mock-server) for the full signature.

---

## See also

- **[CLI reference → mock](./cli.md#mock)**
- **[Spec sync](./spec-sync.md)** — keep the spec the mock is generated from honest.
- **[CI/CD integration](./ci.md)** — run a collection against the mock in a pipeline.
