# File format reference

TruSpec collections are plain-text YAML. This is the complete reference for all three file
types and every field they support.

> **Source of truth.** The [Zod](https://zod.dev) schema in
> [`packages/core/src/format/schema.ts`](https://github.com/code-with-rashid/truspec/blob/main/packages/core/src/format/schema.ts) defines the
> format. A JSON Schema is generated from it into
> [`packages/core/schema/`](https://github.com/code-with-rashid/truspec/tree/main/packages/core/schema) for editors and agents — see
> [Editor integration](#editor-integration). When in doubt, the schema wins.

**Schema version:** `0.1`. Files may carry `tspec: "0.1"`; it's optional and defaults to
`0.1`. Any breaking change bumps the version and ships a migration.

**Strict by default.** Every file type rejects unknown keys, so a typo
(`assertion:` instead of `assertions:`) surfaces immediately as a validation error rather
than being silently ignored.

---

## File types and naming

| File | Schema | Purpose |
|---|---|---|
| `<name>.tspec.yaml` | [Request](#request) | One HTTP request. |
| `folder.tspec.yaml` | [Folder config](#folder-config) | Config inherited by requests in the folder. |
| `environments/<name>.env.yaml` | [Environment](#environment-files) | Variables and secret names for one environment. |

Discovery: any file ending in `.tspec.yaml` (except `folder.tspec.yaml`) is treated as a
request. Environments live in an `environments/` directory at or above the collection.

---

## Request

One request per file. The full set of fields:

```yaml
tspec: "0.1"                       # schema version (optional; defaults to 0.1)
name: Get pet by id                # REQUIRED — a human-readable name
method: GET                        # GET POST PUT PATCH DELETE HEAD OPTIONS (default GET)
url: "{{baseUrl}}/pets/{{petId}}"  # REQUIRED — {{var}} resolved at run time
headers:
  Accept: application/json
query:
  expand: owner
body:
  type: json                       # none | json | text | form | graphql
  content: { name: "Rex" }
auth:                              # optional; can inherit from folder.tspec.yaml
  type: bearer                     # none | bearer | basic | apikey
  token: "{{token}}"
assertions:                        # declarative + machine-checkable
  - { type: status, equals: 200 }
  - { type: jsonpath, path: "$.id", exists: true }
  - { type: duration, ltMs: 1000 }
capture:                           # save response values into vars for later requests
  ownerId: "$.owner.id"
order: 1                           # run order within a collection (lower first; default 0)
script:                            # advanced — see ./scripting.md
  pre: "tr.set('ts', new Date().toISOString())"
  post: "tr.expect(tr.response.status === 200, 'ok')"
docs: "Fetch a single pet by its id."
spec:                              # links request → OpenAPI operation (drift/coverage)
  operation: "GET /pets/{id}"
  operationId: getPetById
```

### Fields

| Field | Type | Required | Default | Notes |
|---|---|---|:---:|---|
| `tspec` | string | no | `"0.1"` | Schema version. |
| `name` | string | **yes** | — | Non-empty. Shown in run output and reports. |
| `method` | enum | no | `GET` | `GET POST PUT PATCH DELETE HEAD OPTIONS`. |
| `url` | string (template) | **yes** | — | May contain `{{vars}}`. Relative URLs are joined onto the folder `baseUrl`. |
| `headers` | map | no | — | String/number/boolean values; templated. |
| `query` | map | no | — | Appended as the query string; templated. |
| `body` | [Body](#bodies) | no | — | Omit entirely for no body. |
| `auth` | [Auth](#auth) | no | inherits folder | Request auth overrides folder auth. |
| `assertions` | [Assertion](#assertions)[] | no | `[]` | Declarative checks. |
| `capture` | map | no | — | [Save response values](#chaining-with-capture) into variables. |
| `order` | number | no | `0` | Lower runs first; ties broken by file path. |
| `script` | `{ pre?, post? }` | no | — | [Scripting](./scripting.md). |
| `docs` | string | no | — | Free-form documentation. |
| `spec` | `{ operation?, operationId? }` | no | — | [Links to an OpenAPI operation](#spec-link). |

---

## Bodies

The `body` field is a tagged union on `type`. Omit `body` (or use `type: none`) for no
request body. The runner sets a default `Content-Type` for each type unless you've already
set one in `headers`.

### `json`

```yaml
body:
  type: json
  content:
    name: Rex
    tags: [good, boy]
```

`content` is any JSON value (object, array, string, number, …). Templated deeply — every
string inside is interpolated. Sent as `application/json`.

### `text`

```yaml
body:
  type: text
  content: "plain text payload {{suffix}}"
```

Sent as `text/plain`.

### `form`

```yaml
body:
  type: form
  content:
    grant_type: password
    username: "{{user}}"
```

A map of string values, serialized as `application/x-www-form-urlencoded`.

### `graphql`

```yaml
body:
  type: graphql
  query: "query($id: ID!) { user(id: $id) { name } }"
  variables: { id: "{{userId}}" }
```

Sent as a `POST` with a JSON `{ query, variables }` body (`application/json`). `variables`
is optional and templated.

---

## Auth

The `auth` field is a tagged union on `type`. Auth can be set on the request or
[inherited from folder config](#folder-config); a request's own `auth` wins. Secrets are
referenced by name (`{{token}}`), never inlined.

| Type | Fields | Effect |
|---|---|---|
| `none` | — | No auth. |
| `bearer` | `token` | `Authorization: Bearer <token>` |
| `basic` | `username`, `password` | `Authorization: Basic <base64(user:pass)>` |
| `apikey` | `name`, `value`, `in` | API key in a header (default) or query param. |

```yaml
auth:
  type: bearer
  token: "{{token}}"
```

```yaml
auth:
  type: apikey
  name: X-API-Key
  value: "{{apiKey}}"
  in: header        # header (default) | query
```

For `apikey` with `in: query`, the key is appended to the URL's query string — and its
value is [masked](#environment-files) in reported output when declared as a secret.

---

## Assertions

Assertions are **declarative and machine-checkable** — they (not JS scripts) are what
power CI gating and [coverage](./spec-sync.md#coverage). Each assertion is an object with a
`type` and one or more conditions. **An assertion must specify at least one condition**; an
assertion with none always fails. When an assertion lists several conditions, *all* of them
must hold.

| Type | Conditions | Checks |
|---|---|---|
| `status` | `equals` · `in: [..]` · `lt` · `gte` | The HTTP status code. |
| `header` | `name` + (`equals` · `matches` · `exists`) | A response header (name is case-insensitive). |
| `jsonpath` | `path` + (`equals` · `exists` · `matches`) | A value selected from the JSON body. |
| `body` | `contains` · `matches` | The raw response body text. |
| `duration` | `ltMs` | Wall-clock request duration (strictly less than). |

### `status`

```yaml
- { type: status, equals: 200 }
- { type: status, in: [200, 201, 204] }
- { type: status, lt: 400 }            # any non-error
- { type: status, gte: 200, lt: 300 }  # combine: a 2xx
```

### `header`

```yaml
- { type: header, name: Content-Type, matches: "application/json" }
- { type: header, name: X-Request-Id, exists: true }
- { type: header, name: Cache-Control, equals: "no-store" }
```

`matches` is a JavaScript regular expression (as a string).

### `jsonpath`

```yaml
- { type: jsonpath, path: "$.id", exists: true }
- { type: jsonpath, path: "$.status", equals: "active" }
- { type: jsonpath, path: "$.items[0].sku", matches: "^SKU-" }
```

- `exists` checks whether the path selects any value.
- `equals` uses **structural equality**, so it works for objects and arrays too.
- `matches` tests the stringified value against a regex.
- The body must parse as JSON; if it doesn't, `jsonpath` assertions don't match.

See [JSONPath support](#jsonpath-support) for the supported subset.

### `body`

```yaml
- { type: body, contains: "ok" }
- { type: body, matches: "\"status\"\\s*:\\s*\"active\"" }
```

Runs against the raw response text — useful for non-JSON responses.

### `duration`

```yaml
- { type: duration, ltMs: 1000 }   # fail if the request took ≥ 1s
```

> **Invalid regexes fail gracefully.** A bad `matches` pattern fails *that* assertion with
> an `assertion error: …` message rather than aborting the whole run.

---

## Chaining with `capture`

`capture` saves values out of a response into **variables** that *later* requests in the
same run can use. Combined with `order`, this expresses login-then-call flows with no
scripting.

```yaml
# auth/01-login.tspec.yaml
name: Log in
method: POST
url: "{{baseUrl}}/login"
order: 1
body:
  type: json
  content: { username: "{{user}}", password: "{{password}}" }
capture:
  token: "$.access_token"     # jsonpath shorthand
```

```yaml
# users/02-me.tspec.yaml
name: Get current user
method: GET
url: "{{baseUrl}}/me"
order: 2
auth:
  type: bearer
  token: "{{token}}"          # the value captured above
```

A capture **source** can be:

| Form | Example | Captures |
|---|---|---|
| jsonpath string (shorthand) | `token: "$.access_token"` | A value from the JSON body. |
| `{ jsonpath }` | `id: { jsonpath: "$.data.id" }` | Same, explicit. |
| `{ header }` | `loc: { header: "Location" }` | A response header value. |
| `{ status: true }` | `code: { status: true }` | The numeric status code. |

Notes:

- Requests run in `order` (ascending), then by file path — so lower-`order` requests can
  feed higher ones.
- A jsonpath that selects an object/array is captured as its JSON string.
- A capture whose source resolves to nothing is simply skipped (the variable stays unset).
- Captures flow forward only within a single `run` invocation; they are not persisted.

---

## Spec link

The `spec` block ties a request to an OpenAPI operation so [drift and
coverage](./spec-sync.md) can reason about it.

```yaml
spec:
  operation: "GET /pets/{id}"   # "${METHOD} ${path}" — matches the spec's path template
  operationId: getPetById       # preferred when both the spec and request have it
```

Matching rules:

- If both the request and the spec operation have an `operationId`, they match on that.
- Otherwise the `operation` string (`METHOD path`) is normalized and matched against the
  spec's `METHOD path` key.

Use the path **template** exactly as it appears in the spec (`/pets/{id}`), not a concrete
URL.

---

## Variables and interpolation

Any string field may contain `{{name}}` placeholders. They're resolved at run time from
the active environment, folder config, secrets, and values captured earlier in the run
(see [Core concepts → Variables](./concepts.md#variables-and-secrets)).

- Placeholder names may contain letters, digits, `.`, `-`, and `_`:
  `{{baseUrl}}`, `{{api.key}}`, `{{user-id}}`.
- Surrounding whitespace is ignored: `{{ token }}` ≡ `{{token}}`.
- Interpolation descends into objects and arrays (e.g. every string in a JSON body).
- **Unresolved variables fail the request before it is sent**, and the run reports exactly
  which names were missing — nothing is silently sent with an empty value baked in.

---

## Folder config

`folder.tspec.yaml` holds configuration inherited by every request in its folder and all
subfolders. It's how you avoid repeating a base URL or auth on every request.

```yaml
tspec: "0.1"
name: Blog                 # optional label
baseUrl: "{{baseUrl}}"     # prepended to relative request URLs
headers:
  Accept: application/json
auth:
  type: bearer
  token: "{{token}}"
```

| Field | Type | Notes |
|---|---|---|
| `tspec` | string | Defaults to `0.1`. |
| `name` | string | Optional label. |
| `baseUrl` | string (template) | Joined onto a request `url` that isn't already absolute. |
| `headers` | map | Merged into each request's headers (request headers win). |
| `auth` | [Auth](#auth) | Used when a request has no `auth` of its own. |

**Composition** (root → leaf, deeper wins):

- `baseUrl`, `auth`, `name` — the deepest value replaces shallower ones.
- `headers` — merged key by key across the chain, then merged with the request's own
  headers (the request wins on conflicts).

A request `url` that begins with `http://` or `https://` is treated as absolute and the
`baseUrl` is *not* applied.

---

## Environment files

Environments live in `environments/<name>.env.yaml` and are selected with `--env <name>`.

```yaml
tspec: "0.1"
name: local                # REQUIRED
variables:
  baseUrl: "http://localhost:4000"
  petId: "1"
secrets:                   # NAMES only — values come from the OS env or a .env file
  - token
```

| Field | Type | Notes |
|---|---|---|
| `tspec` | string | Defaults to `0.1`. |
| `name` | string | **Required.** |
| `variables` | map | String/number/boolean values exposed as `{{name}}`. Default `{}`. |
| `secrets` | string[] | Names of OS/`.env` variables surfaced as `{{name}}`. Default `[]`. |

**Secrets are never stored here** — only their names. At run time each name is looked up
in:

1. a `.env` file at the workspace root (`KEY=VALUE` lines, `#` comments, optional quotes),
   then
2. real OS environment variables, which **win** over the `.env` file.

If a declared secret can't be resolved, `truspec run` prints a warning naming it. Resolved
secret values (6+ characters) are **masked with `***`** everywhere they could surface in
reported output — URLs, bodies, headers, captured values, and error messages — including
their percent-encoded form in query strings.

---

## JSONPath support

`jsonpath` assertions and captures use a small, dependency-free subset of JSONPath, enough
for typical response shapes. A path must start with `$`.

| Syntax | Example | Selects |
|---|---|---|
| Root | `$` | The whole body. |
| Member access | `$.user.name`, `$['user']['name']` | An object property. |
| Array index | `$.items[0]` | An element by index. |
| Negative index | `$.items[-1]` | An element counted from the end. |
| Wildcard | `$.items[*]`, `$.items.*` | All array elements / object values. |

**Not supported in v0:** recursive descent (`..`) and filter expressions (`[?(…)]`). For
exact behavior, see
[`packages/core/src/runner/jsonpath.ts`](https://github.com/code-with-rashid/truspec/blob/main/packages/core/src/runner/jsonpath.ts).

When a path matches multiple values, `equals`/`matches` pass if **any** match satisfies the
condition. If a path selects nothing, `exists: false` passes and `exists: true` fails. A
capture of a multi-match path takes the **first** value.

---

## Editor integration

A JSON Schema is generated from the Zod source into
[`packages/core/schema/`](https://github.com/code-with-rashid/truspec/tree/main/packages/core/schema):

| File | Validates |
|---|---|
| `request.schema.json` | `*.tspec.yaml` request files |
| `folder.schema.json` | `folder.tspec.yaml` |
| `environment.schema.json` | `environments/*.env.yaml` |

Point your editor's YAML language server at them for autocomplete and inline validation.
With the VS Code [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml):

```jsonc
// .vscode/settings.json
{
  "yaml.schemas": {
    "./node_modules/@truspec/core/schema/request.schema.json": "*.tspec.yaml",
    "./node_modules/@truspec/core/schema/environment.schema.json": "environments/*.env.yaml"
  }
}
```

You can also validate programmatically — see
[Programmatic API → format](./api.md#format--parse-validate-serialize). To regenerate the
schema after a format change, run `pnpm gen:schema`.

---

## See also

- **[CLI](./cli.md)** — run and validate these files.
- **[Spec sync](./spec-sync.md)** — drift and coverage off the `spec` link.
- **[Scripting](./scripting.md)** — the `script.pre` / `script.post` escape hatch.
- **[Core concepts](./concepts.md)** — the workspace, inheritance, and variable model.
