# Getting started

This page takes you from zero to a passing run in a few minutes: install the CLI, run
the bundled example end-to-end, then build your own first collection.

> **Prerequisite:** Node ≥ 22. TruSpec uses the platform `fetch` and modern streaming APIs.

---

## Install

The CLI ships as the `truspec` package.

```bash
npm i -g truspec        # global `truspec` command
truspec --help
```

Prefer not to install globally? Every command works through `npx`:

```bash
npx truspec --help
```

Other package managers:

```bash
pnpm add -g truspec
yarn global add truspec
```

> **Hacking on TruSpec itself?** Run from source instead:
> `git clone https://github.com/code-with-rashid/truspec && cd truspec`, then
> `pnpm install && pnpm build`. After that, `node packages/cli/dist/index.js` is the
> `truspec` binary.

---

## Run the example loop (60 seconds, fully offline)

The repository ships ready-made collections plus an OpenAPI spec so you can see the whole
loop — run, mock, drift, coverage — without writing anything. These commands are
copy-paste-safe.

```bash
git clone https://github.com/code-with-rashid/truspec
cd truspec

truspec mock --spec examples/blog/openapi.yaml > /tmp/truspec-mock.log 2>&1 &   # mock on :4000
truspec run examples/blog --env local                   # run requests + assertions
truspec drift examples/blog --spec examples/blog/openapi.yaml
truspec coverage examples/blog --spec examples/blog/openapi.yaml
```

You should see:

- **`run`** report **3 passing** requests against the mock,
- **`drift`** flag **`GET /users/{id}`** as untracked (it's in the spec but no request
  references it yet),
- **`coverage`** show **75% (3/4)** operations tested.

Two examples ship in [`examples/`](https://github.com/code-with-rashid/truspec/tree/main/examples): a small `petstore` and a fuller `blog`.

When you're done, stop the mock server (it was started with `&`):

```bash
kill %1
```

---

## Your first collection

A collection is a folder of plain-text YAML files. Here's a minimal one you can create by
hand.

**1. The request** — `api/get-pet.tspec.yaml` (one request per file):

```yaml
name: Get pet by id
method: GET
url: "{{baseUrl}}/pets/{{petId}}"
assertions:
  - { type: status, equals: 200 }
  - { type: jsonpath, path: "$.id", exists: true }
```

**2. An environment** — `api/environments/local.env.yaml` (provides the `{{variables}}`):

```yaml
name: local
variables:
  baseUrl: "http://localhost:4000"
  petId: "1"
```

**3. Give it something to call.** The request targets `{{baseUrl}}` →
`http://localhost:4000`, so something has to be listening there. The repo ships a petstore
spec that serves `/pets/{id}`, so mock it on port 4000 (run from the cloned repo root):

```bash
truspec mock --spec examples/petstore/openapi.yaml > /tmp/truspec-mock.log 2>&1 &   # mock on :4000
```

The `> /tmp/truspec-mock.log 2>&1` keeps the server's startup banner out of your prompt so
the background job doesn't look like it hijacked the terminal — your shell is ready for the
next command immediately. If the run below ever reports `fetch failed`, check that log to
see whether the mock came up.

> Pointing at a real API instead? Skip this step and set `baseUrl` to that API's URL in
> `local.env.yaml`.

**4. Run it:**

```bash
truspec run ./api --env local
```

```
✓ PASS  Get pet by id  (api/get-pet.tspec.yaml)  200 41ms

1 passed, 0 failed, 1 total
```

When you're done, stop the mock (it was started with `&`):

```bash
kill %1
```

That's the whole flow: a request file, an environment that fills its variables, and a
`run` that checks the assertions and exits non-zero if anything fails — which is exactly
what makes it CI-ready.

> This hand-written request mirrors [`examples/petstore/get-pet.tspec.yaml`](https://github.com/code-with-rashid/truspec/blob/main/examples/petstore/get-pet.tspec.yaml).
> Generate a mock from any OpenAPI spec the same way — `truspec mock --spec openapi.yaml`
> (see the [mock server guide](./mocking.md)).

---

## Recommended project layout

TruSpec discovers everything by convention. A typical repo looks like this:

```
your-repo/
├─ openapi.yaml                     # your API spec (the source of truth)
└─ api/                             # your collection (the "workspace")
   ├─ folder.tspec.yaml             # shared baseUrl / headers / auth
   ├─ environments/
   │  ├─ local.env.yaml
   │  └─ staging.env.yaml
   ├─ auth/
   │  └─ 01-login.tspec.yaml        # order: 1 — captures a token
   └─ pets/
      ├─ list-pets.tspec.yaml
      └─ get-pet.tspec.yaml
```

- **One request per file** (`*.tspec.yaml`) keeps Git diffs clean.
- **`folder.tspec.yaml`** holds config inherited by every request in that folder and below
  (base URL, shared headers, auth).
- **`environments/<name>.env.yaml`** holds per-environment variables; secrets are
  referenced by name and resolved from the OS/`​.env`, never stored in the file.

See **[Core concepts](./concepts.md)** for how discovery, inheritance, and variable
resolution work, and the **[File format reference](./file-format.md)** for every field.

---

## Where to go next

- **[Core concepts](./concepts.md)** — understand the moving parts before you scale up.
- **[File format](./file-format.md)** — the full schema: assertions, bodies, auth, capture.
- **[Spec sync](./spec-sync.md)** — the reason TruSpec exists: keep code and spec honest.
- **[CI/CD integration](./ci.md)** — make `truspec` a build gate.
- **[AI agents (MCP)](./mcp.md)** — let Claude Code author and run your collection.
