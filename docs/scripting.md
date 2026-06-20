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

> **Not a security sandbox.** A `vm` context is *not* an isolation boundary. Scripts are
> authored in your own collection — the same trust model as Postman/Bruno scripts. **Only
> run collections you trust.** Each script is bounded by a ~1s execution timeout.

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
