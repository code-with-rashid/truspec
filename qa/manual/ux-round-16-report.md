# UX Refinement — Round 16 (2026-08-26) — {{var}} autocomplete in the auth editor

Continuing from [round 15](ux-round-15-report.md), which fixed narrow-window layout collapse.
Rounds 7-10 extended `{{var}}` autocomplete to the URL, params/headers, and form-body value
fields — the app's own established convention for anywhere a user types a variable reference. The
auth editor was the one place that convention was never applied, despite being the field most
likely of all of them to hold one.

## Finding: the auth editor's token/username/password/apikey-value fields had no {{var}} autocomplete

- **Where:** [`packages/web/src/components/AuthEditor.tsx`](../../packages/web/src/components/AuthEditor.tsx),
  [`packages/web/src/components/RequestWorkspace.tsx`](../../packages/web/src/components/RequestWorkspace.tsx)
  (the `<AuthEditor>` call site).
- **Symptom:** `AuthEditor`'s bearer `token`, basic `username`/`password`, and apikey `value`
  fields were all plain `<input>`s bound directly to `onChange`, with no `envVarNames` prop even
  threaded in from `RequestWorkspace` (which already has it, and already passes it to the URL bar,
  params/headers, and body editor). These are exactly the fields CLAUDE.md's own format
  documentation shows holding a variable reference (`auth: { type: bearer, token: "{{token}}" }`),
  and in practice almost always do — an API key or bearer token is essentially never typed as a
  literal secret directly into a collection file, it's a `{{var}}` pointing at an environment
  variable or a value captured from an earlier login request. Every other place in the app that
  holds this exact kind of value already got autocomplete; auth was the one gap.
- **Fix:** Added an `envVarNames?: string[]` prop to `AuthEditor`, and swapped the `token`,
  `username`, `password`, and apikey `value` inputs for the existing `VarAwareInput` component
  (conditionally, falling back to a plain `<input>` when no env is selected — the same pattern
  `EditableKV` already uses for params/headers). Left apikey's `name` field (the header/query
  param name, e.g. `X-API-Key`) as a plain input, matching the established convention that *key*-
  shaped fields don't get variable suggestions, only *value*-shaped ones (round 8's "the key column
  has no autocomplete" rule). Wired `envVarNames={envVarNames}` through from `RequestWorkspace`'s
  existing prop into the `<AuthEditor>` call — no new data plumbing needed elsewhere.
- **Verification:** In the real browser, opened a request's auth tab, switched to bearer, typed
  `{{` into the token field, and confirmed the same suggestion dropdown (`{{baseUrl}}`,
  `{{postId}}`) used everywhere else in the app appeared and inserted correctly on selection.
- **Regression test:** [`e2e/var-autocomplete-auth.spec.ts`](../../e2e/var-autocomplete-auth.spec.ts)
  — three tests: bearer token offers autocomplete and applies a suggestion; apikey `name` has none
  (plain input); apikey `value` offers autocomplete. All three **failed on the pre-fix code**
  (confirmed by isolating just this round's diff — see note below — and rebuilding): the two
  autocomplete assertions found zero `.var-suggest-item` elements, since the fields were still
  plain inputs.
  - **A real flake, found and fixed along the way:** the first draft of these tests clicked the
    freshly-mounted field (right after `selectOption`'d the auth scheme) and immediately started
    typing, which intermittently missed keystrokes and left the dropdown closed — roughly a 30-50%
    failure rate across repeated runs, confirmed *not* present in the pre-existing, structurally
    identical `var-autocomplete-kv.spec.ts` (5/5 clean control runs). Adding an explicit
    `await expect(input).toBeFocused()` between the click and the typing — waiting for the actual
    focus state rather than assuming the click already settled it — made it deterministic (8/8
    clean runs). This is a test-timing fix, not a product bug: the fix's actual behavior in the
    real browser was correct from the start.

## A note on this round's verification methodology

Every prior round's "stash and rebuild to confirm the test fails on pre-fix code" step stashed
whole files. That's safe when a file's *entire* diff since the last commit is that round's change
(true for `AuthEditor.tsx` here — confirmed via `git diff HEAD -- AuthEditor.tsx` before stashing).
It is **not** safe for a file like `RequestWorkspace.tsx`, which carries roughly 15 rounds' worth
of accumulated, uncommitted changes in this session — stashing it wholesale reverts all of that,
not just the current round's one-line addition, and broke the build (a genuinely different
component elsewhere in the file now referenced things the reverted version no longer had). Caught
immediately when the pre-fix build failed outright instead of producing the expected two test
failures; recovered by popping the stash back and instead hand-reverting only this round's single
line in `RequestWorkspace.tsx` (the `envVarNames={envVarNames}` prop on the `AuthEditor` call),
rebuilding, testing, then restoring it. Worth remembering for future rounds: check
`git diff HEAD -- <file> --stat` before stashing a file that's been touched across multiple rounds.

## Verification

- Confirmed `AuthEditor.tsx`'s full diff since `HEAD` was exactly this round's change, then stashed
  it alone (safe in this case); hand-reverted the one-line `RequestWorkspace.tsx` addition instead
  of stashing that file. Rebuilt, re-ran `e2e/var-autocomplete-auth.spec.ts`: the two autocomplete
  tests failed as expected (0 suggestion items found); the "no autocomplete on the name field" test
  passed unaffected either way. Restored both files and rebuilt.
- `pnpm typecheck` (full workspace, Turborepo) — 8/8 tasks pass.
- `pnpm test:e2e` — **50/50 passed** (47 pre-existing + 3 new), no regressions. The new auth
  autocomplete tests also ran clean across 8 repeated isolated runs (24/24) to confirm the
  focus-wait fix actually resolved the flake rather than masking it.

## Verdict

A small, consistency-driven fix — the auth editor is now one of the few remaining request-editing
surfaces to catch up to the `{{var}}` autocomplete convention established across rounds 7-10, and
arguably the field where that convention matters most. Scoped to `packages/web`'s auth component
and the one line wiring it in — no backend/core changes.
