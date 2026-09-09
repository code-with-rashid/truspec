# Importing from Postman, Bruno, Insomnia, curl & HAR

`truspec import` converts an existing collection into TruSpec's plain-text format so you
can migrate without rebuilding by hand. It supports **Postman v2.1** collections,
**Bruno** directories, **Insomnia** exports, **`curl` command lines**, and **HAR** exports from
browser devtools.

---

## Quick start

```bash
# Postman — a single exported collection JSON file
truspec import postman ./postman_collection.json --out ./api

# Bruno — a directory of .bru files
truspec import bruno ./bruno-collection --out ./api

# curl — the command itself, straight from devtools' "Copy as cURL"
truspec import curl "curl 'https://api.example.com/pets' -H 'Accept: application/json'" --out ./api

# curl — piped in
pbpaste | truspec import curl - --out ./api

# Insomnia — an exported collection JSON (v4 or v5)
truspec import insomnia ./insomnia_export.json --out ./api

# HAR — "Save all as HAR" from the browser's Network panel
truspec import har ./session.har --out ./api --filter api.example.com --base-url-var baseUrl
```

A devtools HAR of a single page load is mostly the asset pipeline: the document, stylesheets,
script chunks, images, fonts. Those are skipped by default — the same call `OPTIONS` preflights
get, and for the same reason: they are not API surface, and importing them leaves a collection you
have to prune before it is usable. The decision is made from the **recorded response content type**,
never the URL, and an entry whose type the HAR did not record is kept.

The count is always reported (`Skipped 8 static asset(s) …`), and `--include-assets` keeps
everything. Use it when your API genuinely serves one of those types — an avatar or a PDF endpoint
looks exactly like a page asset from the outside, and nothing can tell them apart for you.

Each source request becomes one `<name>.tspec.yaml` file, preserving the folder structure
of the original collection.

---

## Preview before you write (dry run)

Run without `--out` (or pass `--dry-run`) to see exactly which files *would* be written —
a safe way to inspect the conversion before committing to a destination:

```bash
truspec import postman ./postman_collection.json
```

```
12 request(s), 3 folder(s) — 12 file(s):
  auth/login.tspec.yaml
  pets/list-pets.tspec.yaml
  pets/get-pet.tspec.yaml
  ...

(dry run — pass --out <dir> to write the files)
```

---

## Options

```
truspec import <postman|bruno|insomnia|curl|har> <path> [--out <dir>] [--dry-run] [--name <base>]
                                             [--filter <substr>] [--base-url-var <name>]
                                             [--keep-noise-headers] [--include-options]
                                             [--include-assets]
```

| Argument / flag | Alias | Description |
|---|---|---|
| `<postman\|bruno\|insomnia\|curl\|har>` | | **Required.** Source format. |
| `<path>` | | **Required.** Postman JSON, Bruno directory, a curl command (`-` for stdin), or a `.har`. |
| `--out <dir>` | `-o` | Destination directory. Omit for a dry-run preview. |
| `--dry-run` | | Force preview mode even when `--out` is given. |
| `--name <base>` | | curl only: base filename, instead of a slug of the derived request name. |
| `--filter <substr>` | | HAR only: import only entries whose URL contains this. |
| `--base-url-var <name>` | | HAR only: replace the recorded origin with `{{name}}`. |
| `--keep-noise-headers` | | HAR only: keep `sec-*`, `user-agent`, … (stripped by default). |
| `--include-options` | | HAR only: keep `OPTIONS` preflights (skipped by default). |
| `--include-assets` | | HAR only: keep static assets — documents, styles, scripts, images, fonts, media (skipped by default). |

---

## Importing from Insomnia

Insomnia stores a collection as a **flat** `resources` array with `parentId` pointers, not a tree,
so folders are reassembled by walking parents (with a cycle guard — a malformed export can point a
group at itself). Rows the user **disabled** are skipped rather than imported as live headers and
parameters, and `{{ _.var }}` templates are normalized to `{{var}}`.

An OAuth2 block is imported only for the grants a machine can complete unattended
(`client_credentials`, `password`, `refresh_token`); an authorization-code flow needs a browser, so
it is reported rather than imported as a block that could never run.

---

## Importing a HAR

A HAR is the browser's own record of what an app actually did — the fastest route from
"reproduce this bug" to a committed regression test. The import is deliberately opinionated so
the result reads like a collection someone wrote rather than a packet dump:

- **Browser noise is stripped** — `sec-*`, `user-agent`, `:authority`, `content-length`, `host`,
  `accept-encoding` and friends. Several are actively wrong to replay (`content-length` is
  recomputed; `accept-encoding` would make the recorded body unreadable), and keeping the rest
  would bury the two headers that matter under thirty that don't. `--keep-noise-headers` opts out.
- **`OPTIONS` preflights are skipped** — they are transport, not API surface.
- **Each request asserts the status that was actually recorded**, so the import captures observed
  behavior rather than a generic "didn't 4xx".
- **`--base-url-var`** rewrites the recorded origin to `{{baseUrl}}`, which is what makes the
  result usable against staging as well as the host it was recorded from.
- Bearer/basic `Authorization` becomes structured `auth`; JSON and urlencoded bodies become typed
  bodies. A multipart entry imports its field names and values, with a warning that **a HAR does
  not store file contents**.

Because a HAR usually contains real session tokens, treat the output the way you would a pasted
curl command: move credentials into an [environment secret](./concepts.md) before committing.

---

## Importing a curl command

“Copy as cURL” in Chrome/Firefox devtools is the shortest path from a request you just watched
happen to a request you can replay, assert on, and commit. Paste the command as the argument (or
pipe it in with `-`) and TruSpec converts it into a real request file:

```bash
truspec import curl "curl 'https://api.example.com/pets?expand=owner' \
  -H 'Authorization: Bearer abc' -H 'Accept: application/json'" --out ./api
```

```yaml
# api/get-pets.tspec.yaml
tspec: "0.1"
name: GET pets
method: GET
url: https://api.example.com/pets
headers:
  Accept: application/json
query:
  expand: owner
auth:
  type: bearer
  token: abc
assertions:
  - { type: status, lt: 400 }
```

What it handles: shell quoting (including `$'…'` and `\`-continuations), `-X`, `-H`, `-d` /
`--data-raw` / `--data-urlencode` / `--json`, `-G`, `-I`, `-F`, `-u`, `-A`, `-e`, `-b`, `--url`,
and combined short flags (`-XPOST`). A bearer or basic `Authorization` header becomes an `auth`
block instead of a raw header. Several commands in one paste import as several files.

`-F` becomes a real [`multipart` body](./file-format.md#multipart), including `@path` file parts
and their `;type=` / `;filename=` modifiers.

What it warns about rather than silently dropping: `-k` (skip TLS verification) and `--proxy`,
neither of which has a request-file equivalent. Also note that a pasted command usually contains **real credentials** —
move them into an [environment secret](./concepts.md) before committing the file.

---

## What gets converted

The importer maps the common surface of each format onto TruSpec's
[file format](./file-format.md):

- **Method, URL, headers, query parameters.**
- **Request bodies** — JSON, raw text, and form bodies map to the corresponding
  [`body` types](./file-format.md#bodies).
- **Auth** — bearer, basic, and API-key auth map to TruSpec [`auth`](./file-format.md#auth).
- **Folder structure** — preserved as directories of `.tspec.yaml` files.
- **Bruno `assert` blocks** — `res.status`, `res.responseTime` (to a `duration` assertion),
  `res.body.<path>` with any of `eq neq gt gte lt lte contains matches length isDefined
  isUndefined isNull isEmpty isNotEmpty isString isNumber isBoolean isArray`, and
  `res.headers['name']`. Two constraints on the same field both survive.
- **Bruno `vars:post-response`** — becomes [`capture`](./file-format.md#chaining-with-capture),
  so a login that saves a token still saves it and the chain still runs.

Everything is run through the schema and **validated before it's written**, so an import
never produces a file that won't parse.

---

## What doesn't carry over

Some source features have no faithful equivalent in TruSpec v0, and the importer is honest
about it. Watch the **warnings** printed during conversion:

- **Imperative test scripts** (Postman `pm.test(...)`, Bruno JS) don't map onto TruSpec's
  [declarative assertions](./file-format.md#assertions). Re-express the important checks as
  assertions, or — as a last resort — a [post-response script](./scripting.md).
- **Environment/secret values** are not imported into your files; TruSpec
  [references secrets by name](./file-format.md#environment-files) rather than storing them.
- **Vendor-specific settings** (proxies, certificates, visualizers, etc.) are dropped.

Each skipped or partially-converted item produces a `warning:` line so nothing is lost
silently.

---

## After importing

A conversion is a starting point, not the finish line. To get the full value of TruSpec:

1. **Add a spec link.** Tie each request to its OpenAPI operation with a
   [`spec` block](./file-format.md#spec-link) so [drift and coverage](./spec-sync.md) work.
   If you have a spec, [`truspec gen`](./spec-sync.md#scaffolding-from-a-spec) can scaffold
   those links for you to merge in.
2. **Turn tests into assertions.** Replace imported script-based checks with
   [declarative assertions](./file-format.md#assertions).
3. **Move secrets out of files.** Declare them by name in an
   [environment](./file-format.md#environment-files) and resolve from your OS/`.env`.
4. **Review the diff.** Because the output is plain text, the whole conversion is reviewable
   in a single pull request.

---

## Programmatic use

The importers are part of `@truspec/core`:

```ts
import { importPostmanFile, importBrunoDir, writeImport } from "@truspec/core/importers";

const result = importPostmanFile("./postman_collection.json");
console.log(result.stats);     // { requests, folders }
console.log(result.warnings);  // anything that didn't convert cleanly
writeImport(result, "./api");  // write the .tspec.yaml files
```

See [Programmatic API → importers](./api.md#importers--postman--bruno).

---

## Exporting back to Postman

Going the other way — handing a collection to someone who works in Postman — is available from the
web UI's export button and from `@truspec/core/exporters`:

```ts
import { exportPostman } from "@truspec/core/exporters";

const { collection, warnings, stats } = exportPostman("./api");
```

**Assertions come back too.** Importing a Postman collection recovers declarative assertions from
its `test` scripts — `pm.response.to.have.status(200)`, `pm.expect(pm.response.code).to.eql(201)`,
response-time and header checks, `pm.expect(pm.response.text()).to.include(...)`, and a value read
off `pm.response.json()` by accessor chain or `_.get`. Anything not recognised stays in the ported
comment for you to port by hand, because a guessed assertion is worse than an honest gap. Before
this, an imported collection ran without checking anything and reported 0% coverage.

**Assertions come with it.** Each request's declarative assertions are rendered as a Postman test
script (`pm.test(...)`), so the exported collection still checks what the TruSpec one checked
rather than becoming a set of requests that assert nothing. `status`, `header`, `body` and
`duration` map directly; a `jsonpath` maps when it is simple enough for the lodash `_.get` Postman
ships (`$.data.items[0].id` yes, a filter or a `..` descent no).

Anything with no Postman equivalent is reported in `warnings` rather than dropped silently:
`schema` assertions (they need the OpenAPI spec, which a Postman collection does not carry), a
`jsonpath` too complex to express, transport `options`, OAuth2 `audience`/`extra`, and the `spec`
link itself. Those survive only in the `.tspec.yaml` files you exported from — which is the
argument for keeping those the source of truth.

---

## See also

- **[CLI reference → import](./cli.md#import)**
- **[File format](./file-format.md)** — the format you're converting into.
- **[Spec sync](./spec-sync.md)** — make the imported collection drift-aware.
