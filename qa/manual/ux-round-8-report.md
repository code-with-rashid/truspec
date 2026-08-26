# UX Refinement — Round 8 (2026-08-26)

Continuing from [round 7](ux-round-7-report.md), which added `{{var}}` autocomplete to the URL
input only. This round extends the same component to params/headers value fields.

## Findings

- **`{{var}}` autocomplete was URL-only — params and headers values got no suggestions.**
  - **Where:** [`packages/web/src/components/EditableKV.tsx`](../../packages/web/src/components/EditableKV.tsx)
    (the shared row-editor behind params, headers, and form-body), wired from
    [`packages/web/src/components/RequestWorkspace.tsx`](../../packages/web/src/components/RequestWorkspace.tsx).
  - **Fix:** Added an optional `varSuggestions?: string[]` prop to `EditableKV`; when provided (and
    non-empty), the **value** column renders via round 7's `VarAwareInput` instead of a plain
    `<input>` — the **key** column stays plain, since a variable reference belongs in a value, not
    a header/param name. Wired `varSuggestions={envVarNames}` into both of `RequestWorkspace`'s
    `EditableKV` calls (params, headers). Left `BodyEditor`'s own `EditableKV` usage (the `form`
    body type) untouched for this round, to keep the diff reviewable.
  - **A layout regression caught before it shipped:** `VarAwareInput` renders its `<input>` inside
    a wrapper `<div class="var-input-wrap">`, one level deeper than the plain input it replaces.
    `.editable-kv-key`/`.editable-kv-value` were `flex: 1` / `flex: 2` (a 1:2 key:value width
    ratio) directly on the `<input>` — moving the input inside a wrapper meant that ratio no
    longer applied to anything, and the wrapper's own flex value (inherited from round 7's
    URL-bar-specific `flex: 1`) would have made key and value columns equal width, narrowing every
    header/param value field. Fixed by making the wrapper's flex share context-specific
    (`.url-bar .var-input-wrap { flex: 1 }`, `.editable-kv-row .var-input-wrap { flex: 2 }`)
    instead of one hardcoded value — confirmed visually afterward that a newly-added header row
    still showed the same roughly-2:1 value:key width split as before.
  - **Verification:** In the real browser, added a header row on `Get post`, typed `{{base` into
    the value field, confirmed the `{{baseUrl}}` suggestion appeared positioned directly under
    that field (not the URL bar's position), and that the key field showed no suggestions for the
    same input. Discarded the test edit afterward (`discard` button, confirmed the on-disk file
    was untouched).
  - **Regression test:** [`e2e/var-autocomplete-kv.spec.ts`](../../e2e/var-autocomplete-kv.spec.ts) —
    (1) a new header row's `.editable-kv-value` shows `{{baseUrl}}` on typing `{{ba` and inserts it
    on click; (2) the same input sequence in `.editable-kv-key` shows no suggestions. (1) fails on
    the pre-fix code (`.var-suggest-item` never appears) via the same stash/rebuild/run/pop cycle
    as prior rounds; (2) passes unchanged either way (an inherent absence, not itself evidence of
    the fix), included for documentation/regression-guard value rather than as the round's proof.

## Verification

- `pnpm typecheck` (full workspace) — 8/8 tasks pass.
- `pnpm --filter @truspec/web build` — pass.
- `pnpm test:e2e` — **32/32 passed** (30 pre-existing + 2 new), no regressions.

## Verdict

1 feature gap closed (autocomplete now covers the three most common places to reference a
variable: URL, params, headers), plus a layout regression caught and fixed during verification
rather than shipped. Continuing to round 9.
