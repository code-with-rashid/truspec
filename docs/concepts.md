# Core concepts

A short tour of the model behind TruSpec. Once these click, the
[file format](./file-format.md) and [CLI](./cli.md) read as a thin surface over a few
ideas.

---

## The four principles

Everything in TruSpec follows from four commitments:

1. **Open-source first** — no feature paywalls, no mandatory account.
2. **Local-first** — everything works offline; your files are the source of truth.
3. **Agent-native** — every capability is reachable three ways: plain files, a `--json`
   CLI, and an [MCP server](./mcp.md). No capability is locked behind a GUI.
4. **Refuse bloat** — speed and focus are the product. Dashboards, flow builders,
   mandatory cloud sync, and exotic protocols are deliberately *out*.

---

## Collections are plain text

A **collection** is a folder of YAML files. There is no binary database, no proprietary
export format, and no hidden state — the files *are* the collection.

| File | Purpose |
|---|---|
| `<name>.tspec.yaml` | One HTTP request, its assertions, and its spec link. |
| `folder.tspec.yaml` | Config inherited by every request in that folder and below. |
| `environments/<name>.env.yaml` | Variables and secret *names* for one environment. |

Because they're plain text, they diff cleanly in Git, review well in a pull request, and
can be authored by a human, a script, or an [AI agent](./mcp.md) with equal ease. The
hard rule that makes this work: **TruSpec validates before it writes**, so a malformed
file never lands in your repo.

---

## The spec is the source of truth

Most API clients treat the collection as the canonical artifact and the spec (if any) as a
side note. TruSpec inverts that: your **OpenAPI document is the source of truth**, and the
collection is measured against it.

A request links back to a spec operation with a `spec:` block:

```yaml
spec:
  operation: "GET /pets/{id}"   # `${METHOD} ${path}`
  operationId: getPetById       # preferred when present
```

That link powers two checks that run offline and in CI:

- **[Drift](./spec-sync.md#drift)** — what's in the spec but untracked by any request,
  what's referenced but no longer in the spec, and what's matched but no longer satisfies
  the spec (e.g. a now-required parameter).
- **[Coverage](./spec-sync.md#coverage)** — what share of spec operations are actually
  exercised by a request *with assertions*.

This is the feature that distinguishes TruSpec: your collection can't silently rot away
from your API, because the build fails the moment it does.

---

## The workspace

The **workspace** is the root TruSpec resolves environments and folder config from. You
never configure it explicitly — it's discovered by walking up the directory tree from the
request you're running until it finds a directory containing an `environments/` folder or
a `.git` directory.

That means a collection nested anywhere inside your repo still resolves the right
environments, and a root `.env` is found regardless of which subfolder you run.

---

## Folder inheritance

`folder.tspec.yaml` files compose from the workspace root down to the request's folder.
Deeper files win. This lets you set a base URL or shared headers once:

```yaml
# api/folder.tspec.yaml
name: My API
baseUrl: "{{baseUrl}}"
headers:
  Accept: application/json
auth:
  type: bearer
  token: "{{token}}"
```

Merge rules:

- **`baseUrl`, `auth`, `name`** — the deepest value replaces shallower ones.
- **`headers`** — merged key by key (a child can add or override individual headers).
- At request time, **the request's own `headers`/`auth`/`url` win** over inherited config,
  and a relative request `url` is joined onto the inherited `baseUrl`.

See [File format → Folder config](./file-format.md#folder-config) for the full rules.

---

## Variables and secrets

Any string can contain `{{name}}` templates, resolved at run time. Values come from
several sources, resolved in this order (later wins):

1. `variables:` in the active environment file.
2. **Secrets** declared by name in the environment, resolved from a workspace `.env` file
   and then from real OS environment variables (OS wins).
3. Values [captured](./file-format.md#chaining-with-capture) from earlier requests in the
   same run.

Secrets are **never stored in your files** — the environment lists only their *names*:

```yaml
# environments/staging.env.yaml
name: staging
variables:
  baseUrl: "https://api.staging.example.com"
secrets:
  - token        # value comes from $token (OS env) or a .env file, never from here
```

When a run reports its results, declared secret values are **masked with `***`** in URLs,
bodies, headers, captured values, and error messages — so `--json` output and CI logs
don't leak them. See [File format → Environments](./file-format.md#environment-files).

---

## How a run flows

When you `truspec run`, each request goes through the same pipeline:

```
parse → pre-script → resolve → fetch → assert → capture → post-script
```

1. **Parse** the YAML and validate it against the schema.
2. **Pre-request script** (optional) runs first and can set variables.
   See [Scripting](./scripting.md).
3. **Resolve** — interpolate `{{variables}}`, apply folder inheritance, build auth headers,
   assemble the query string and body into a concrete HTTP request. Unresolved variables
   fail the request *before* anything is sent.
4. **Fetch** the request (default 30s timeout; response body capped to guard memory).
5. **Assert** — evaluate the declarative [assertions](./file-format.md#assertions) against
   the response.
6. **Capture** — save response values into variables for *later* requests.
7. **Post-response script** (optional) can add assertions and capture more values.

Requests in a directory run in **`order`** (ascending, then by file path), so a login can
capture a token the next request consumes. The run exits **non-zero** if any request
fails — which is what makes the same command work locally and as a CI gate.

---

## The engine, the CLI, and the agent surface

The same engine powers every entry point, so behavior is identical no matter how you drive
it:

```
@truspec/core  — the engine (pure TypeScript)
  ├─ format      parse / serialize / validate (+ published JSON Schema)
  ├─ runner      interpolation, auth, fetch, declarative assertions, scripts
  ├─ workspace   discovery, folder inheritance, env + secret resolution
  ├─ spec        OpenAPI drift + coverage + response contract validation
  ├─ importers   Postman v2.1 + Bruno → .tspec.yaml
  └─ mock        local mock server generated from a spec
truspec              — the CLI
@truspec/mcp-server  — the agent surface (11 MCP tools)
@truspec/web         — the local web UI (truspec serve)
```

Run it from your terminal, your CI, your editor, or your AI agent — it's the same code
underneath. Read on:

- **[File format](./file-format.md)** — the complete schema reference.
- **[CLI](./cli.md)** — every command and flag.
- **[Programmatic API](./api.md)** — drive the engine from TypeScript.
