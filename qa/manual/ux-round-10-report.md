# UX Refinement — Round 10 (2026-08-26)

Continuing from [round 9](ux-round-9-report.md). Intended scope: extend rounds 7-8's `{{var}}`
autocomplete to the last uncovered `EditableKV` usage — `BodyEditor`'s `form` body type. Writing
that test surfaced a real, more severe pre-existing bug.

## Findings

- **A form-body field could not be added at all — it vanished the instant you clicked "+ add",
  before any typing was possible.**
  - **Where:** [`packages/web/src/components/BodyEditor.tsx`](../../packages/web/src/components/BodyEditor.tsx).
  - **Symptom:** Switch a request's body to `form`, click "+ add" — nothing persists. Writing the
    round's intended `{{var}}`-autocomplete test (`.click(".editable-kv-add")` then
    `.click(".editable-kv-value")`) hung on a 30s timeout waiting for `.editable-kv-value`, which
    never appeared.
  - **Root cause:** `BodyEditor` derived `EditableKV`'s `rows` prop directly from
    `objectToRows(body.content)` on every render, with no local buffer — unlike
    `RequestWorkspace`'s `queryRows`/`headerRows`, which exist specifically to survive this. A
    freshly-added row starts with a blank key; `EditableKV`'s `onChange` calls
    `rowsToObject(rows)`, and `rowsToObject` **drops any row whose trimmed key is empty** (by
    design — it's how a blank/duplicate key avoids silently colliding with a real one while
    typing). Because `BodyEditor` re-derived `rows` from that same (now-still-`{}`) object on the
    very next render, the just-added row disappeared before the user could type a single
    character into either its key or its value.
  - **Fix:** Mirrored `RequestWorkspace`'s existing pattern exactly: `BodyEditor` now keeps its own
    `formRows` state, seeded once and re-synced only when the body `type` changes (matching
    `setType`'s own reset of `content` to `{}` when switching into `form` from something else) —
    not on every keystroke. `EditableKV`'s `onChange` updates both the local buffer and calls the
    parent `onChange`, so a form field can now actually be typed into, and — combined with round
    8's `varSuggestions` plumbing — also gets `{{var}}` autocomplete.
  - **Verification:** In the real browser, on `Create post`: switched body type to `form`, clicked
    "+ add" (row now persists, confirming the fix), typed a key (`title`) and value (`Hello`) —
    both held their text instead of reverting to placeholders. Discarded the test edit afterward.
  - **Regression tests:** [`e2e/var-autocomplete-body.spec.ts`](../../e2e/var-autocomplete-body.spec.ts) —
    (1) the originally-intended autocomplete test (typing `{{ba` in a form-body value field shows
    `{{baseUrl}}`); (2) a dedicated test for the row-persistence bug itself — add a field, type a
    key and value, save, and assert the on-disk file contains both (the more important of the two,
    since it guards the actual functional break, not just the newer autocomplete feature). Both
    fail on the pre-fix code — (1) and (2) both time out waiting for `.editable-kv-value` /
    `.editable-kv-key` to ever appear, which is itself direct evidence of the bug — via the same
    stash/rebuild/run/pop cycle as prior rounds.

## Verification

- `pnpm typecheck` (full workspace) — 8/8 tasks pass.
- `pnpm --filter @truspec/web build` — pass.
- `pnpm test:e2e` — **36/36 passed** (34 pre-existing + 2 new), no regressions.

## Verdict

1 real, severe pre-existing bug found and fixed (form bodies were unusable through the UI) while
pursuing what was meant to be a minor autocomplete-coverage round — a good example of why writing
the test for a "small" feature is itself worth doing even when the feature seems trivial. `{{var}}`
autocomplete now covers every `EditableKV` surface (URL, params, headers, form body).

This is a natural point to check in again: 10 rounds since the start, 4 since the last checkpoint,
including one real functional bug fix and one real accessibility bug fix, both surfaced by
pursuing what looked like small polish items.
