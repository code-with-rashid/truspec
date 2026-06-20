# Importing from Postman & Bruno

`truspec import` converts an existing collection into TruSpec's plain-text format so you
can migrate without rebuilding by hand. It supports **Postman v2.1** collections and
**Bruno** directories.

---

## Quick start

```bash
# Postman — a single exported collection JSON file
truspec import postman ./postman_collection.json --out ./api

# Bruno — a directory of .bru files
truspec import bruno ./bruno-collection --out ./api
```

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
truspec import <postman|bruno> <path> [--out <dir>] [--dry-run]
```

| Argument / flag | Alias | Description |
|---|---|---|
| `<postman\|bruno>` | | **Required.** Source format. |
| `<path>` | | **Required.** Postman JSON file, or Bruno directory. |
| `--out <dir>` | `-o` | Destination directory. Omit for a dry-run preview. |
| `--dry-run` | | Force preview mode even when `--out` is given. |

---

## What gets converted

The importer maps the common surface of each format onto TruSpec's
[file format](./file-format.md):

- **Method, URL, headers, query parameters.**
- **Request bodies** — JSON, raw text, and form bodies map to the corresponding
  [`body` types](./file-format.md#bodies).
- **Auth** — bearer, basic, and API-key auth map to TruSpec [`auth`](./file-format.md#auth).
- **Folder structure** — preserved as directories of `.tspec.yaml` files.

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

## See also

- **[CLI reference → import](./cli.md#import)**
- **[File format](./file-format.md)** — the format you're converting into.
- **[Spec sync](./spec-sync.md)** — make the imported collection drift-aware.
