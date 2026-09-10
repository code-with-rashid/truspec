# Scripting

TruSpec is **declarative first**: prefer [assertions](./file-format.md#assertions),
[capture](./file-format.md#chaining-with-capture), and [variables](./concepts.md#variables-and-secrets)
because they're machine-checkable and power [coverage](./spec-sync.md#coverage). Scripts are
the escape hatch for the few things substitution can't express — dynamic timestamps and
nonces, request signing, derived headers, or a one-off response check.

A request can carry two optional scripts:

```yaml
script:
  pre: |
    # runs BEFORE the request is resolved — compute values to interpolate
  post: |
    # runs AFTER the response — assert on it, capture more values
```

Both run in a Node `vm` context with a curated `tr` API. They set **variables**, not the
request object directly — so to use a computed value, set it in the script and reference it
as `{{name}}` in the request.

> **Not a security sandbox.** A `vm` context is *not* an isolation boundary, and it is worth being
> concrete about what that means rather than leaving it abstract. Obvious globals are absent —
> `process`, `require` and `fetch` are all `undefined` inside a script — but a script can still
> reach the host realm through any object handed into the context, and from there it has **the same
> access as the `truspec` process itself**: every environment variable (including every resolved
> secret), and every file your user account can read or write.
>
> That is the same trust model as Postman and Bruno scripts, and it is fine for a collection you
> wrote. It matters for one you **imported, were sent, or generated** — exactly the case where
> nobody thinks to open the files first. `truspec lint` flags every request carrying a script
> (`script-runs-unsandboxed`), so a freshly imported collection tells you what to review before you
> run it. **Only run collections you trust.**
>
> Each script is bounded by a ~1s execution timeout, which bounds a runaway loop — not access.

---

## Pre-request script

Runs **before** the request is resolved, so the values it sets can be interpolated into the
URL, headers, query, or body. A script error fails the request *without sending it*.

```yaml
script:
  pre: |
    tr.set("nonce", tr.uuid())
    tr.set("ts", new Date().toISOString())
    tr.set("sig", tr.hmac("sha256", tr.vars.apiSecret, tr.vars.ts + tr.vars.nonce))
headers:
  X-Nonce: "{{nonce}}"
  X-Timestamp: "{{ts}}"
  X-Signature: "{{sig}}"
```

### The `tr` API (pre-request)

There is no response yet, so the pre-request API is about reading variables and computing
new ones:

| Member | Description |
|---|---|
| `tr.vars` | Snapshot of the current variables (read-only). |
| `tr.set(name, value)` | Set a variable used by this request. Objects/arrays are JSON-stringified. |
| `tr.uuid()` | A random UUID v4. |
| `tr.base64(s)` | Base64-encode a string. |
| `tr.hmac(algo, key, data, enc?)` | HMAC digest. `enc` is `"hex"` (default) or `"base64"`. |
| `tr.env(name)` | Read an OS environment variable. |

Because `tr.set` records a *variable*, build any computed body or header value as a
variable and reference it with `{{…}}` — you can't mutate the request body inline from the
script.

---

## Post-response script

Runs **after** the response, with access to it. Use it to assert on something the
declarative types can't express, or to capture a derived value for later requests.

```yaml
script:
  post: |
    tr.set("token", tr.response.json.access_token)
    tr.expect(tr.response.status === 200, "logged in")
    tr.expect(tr.response.json.items.length > 0, "got at least one item")
```

### The `tr` API (post-response)

| Member | Description |
|---|---|
| `tr.response` | `{ status, headers, bodyText, json }` — `json` is parsed when the body is JSON; `headers` keys are lowercased. |
| `tr.vars` | Snapshot of the current variables (including values captured so far). |
| `tr.set(name, value)` | Capture a variable for later requests. Objects/arrays are JSON-stringified. |
| `tr.expect(cond, msg)` | Record a pass/fail assertion with a message. |

`tr.expect` failures and a thrown script error both fail the request, and the messages show
up in the run report alongside declarative assertion failures.

---

## Printing from a script

`console.log`, `.info`, `.warn`, `.error` and `.debug` work in both phases, and their output is
**collected into the run result** rather than written to a stream:

```yaml
script:
  pre: |
    const sig = tr.hmac("sha256", tr.env("API_SECRET"), tr.vars.ts)
    console.log("signing with", { ts: tr.vars.ts, sig })
    tr.set("sig", sig)
```

```
✓ PASS  Signed  (api/signed.tspec.yaml)  200 41ms
      › signing with { ts: '2026-09-09T12:00:00.000Z', sig: '98755ce7…' }
```

The same lines appear as `scriptLogs` in `truspec run --json`, and in the response pane of the web
UI. Collecting them rather than printing them directly is what makes them work everywhere: the
[MCP server](./mcp.md) speaks JSON-RPC over stdout, where a stray line corrupts the protocol, and
the browser client has no stdout at all.

Two details worth knowing:

- **Output from a script that threw is kept**, and is shown with the error. A script fails at the
  line after the one you were trying to inspect more often than not.
- **A runaway loop is capped** at 100 lines and 2,000 characters per line. The cap announces
  itself as a final line rather than quietly dropping the rest.

Values are formatted the way Node's own console formats them, so an object prints as
`{ a: 1, b: [ 1, 2 ] }` rather than `[object Object]`.

---

## When to reach for a script

| Need | Prefer | Script only if… |
|---|---|---|
| Check a status code / header / JSON value | [Assertions](./file-format.md#assertions) | the condition is genuinely computed. |
| Reuse a token from a login | [`capture`](./file-format.md#chaining-with-capture) | the value needs transformation first. |
| Insert an environment value | [Variables](./concepts.md#variables-and-secrets) | — |
| Dynamic timestamp / nonce / UUID | — | `pre` script (`tr.uuid`, `new Date()`). |
| HMAC request signing | — | `pre` script (`tr.hmac`). |
| Cross-field response validation | — | `post` script (`tr.expect`). |

Keeping logic declarative wherever possible means your collection stays reviewable,
diffable, and visible to [coverage](./spec-sync.md#coverage) — scripts are invisible to it.

---

## See also

- **[File format → Assertions](./file-format.md#assertions)** — the declarative path.
- **[File format → Capture](./file-format.md#chaining-with-capture)** — chaining without
  scripts.
- **[Programmatic API → runner](./api.md#runner--execute-a-request)** — `runPreScript` /
  `runPostScript`.
