# UX Refinement — Round 20 (2026-08-26) — folder settings had no {{var}} autocomplete

Continuing from [round 19](ux-round-19-report.md). Checked the other place headers/auth get
edited — `FolderSettingsModal`, not just a single request — for the same consistency gap round 16
found in the request-level auth editor.

## Finding: a folder's base-url/headers/auth fields never got the {{var}} autocomplete request-level fields have had since rounds 8/16

- **Where:** [`packages/web/src/components/FolderSettingsModal.tsx`](../../packages/web/src/components/FolderSettingsModal.tsx),
  [`packages/web/src/App.tsx`](../../packages/web/src/App.tsx) (the `<FolderSettingsModal>` call site).
- **Symptom:** `FolderSettingsModal`'s base-url `<input>` was plain, its `<EditableKV>` call for
  headers omitted `varSuggestions`, and its `<AuthEditor>` call omitted `envVarNames` — none of
  which get passed the app's already-existing `envVarNames` state at all. A folder's config
  inherits down to every request inside it, so its base URL, headers, and auth are if anything
  *more* likely to reference a variable than a single request's own — the base-url field's own
  placeholder text literally reads `"base url, e.g. {{baseUrl}}"`, contradicting its own lack of
  autocomplete help.
- **Fix:** Threaded `envVarNames` through: added the prop to `FolderSettingsModal`, wrapped the
  base-url input in `VarAwareInput` (conditionally, matching the established fallback-to-plain-input
  pattern), and passed `varSuggestions`/`envVarNames` to the existing `EditableKV`/`AuthEditor`
  calls — no new components needed, this was purely wiring gaps in a modal that otherwise already
  built its fields from the same shared components request-editing uses.
- **Verification:** In the real browser: opened a folder's settings, typed `{{` into the base-url
  field, confirmed the same `{{baseUrl}}`/`{{postId}}` suggestion dropdown appeared and applied
  correctly on selection; confirmed the same for a newly-added header's value field.
- **A flake caught and fixed via the round 16 pattern:** the regression test initially clicked the
  suggestion dropdown item with a mouse (`page.click(".var-suggest-item")`) after typing — passed
  reliably in isolation (6/6) but failed intermittently in the full suite run ("element was
  detached from the DOM, retrying"), a timing race between the dropdown's `position: fixed` rect
  and the modal's own layout settling. Fixed the same way round 16's auth-editor flake was fixed:
  added an explicit `await expect(input).toBeFocused()` before typing, and — going one step further
  here — replaced the mouse click on the suggestion with a keyboard `Enter` (`VarAwareInput`
  already supports it), sidestepping the position-based click entirely. Confirmed clean across 5
  isolated runs and 1 full-suite run afterward.
- **Regression test:** [`e2e/folder-settings-autocomplete.spec.ts`](../../e2e/folder-settings-autocomplete.spec.ts)
  — creates a folder, opens its settings, types into the base-url field and confirms/accepts a
  suggestion, then does the same for a newly-added header value. **Failed on the pre-fix code**
  (zero `.var-suggest-item` elements found) — confirmed by stashing `FolderSettingsModal.tsx`
  (its entire diff since `HEAD` was exactly this round's change, confirmed via `git diff --stat`
  before stashing) and hand-reverting the one-line `App.tsx` addition, rebuilding — bundle hashed
  identically to the round-19 build — then restoring both and rebuilding again, matching the
  round-20 build's hashes exactly.

## Verification

- Stashed/hand-reverted per above, rebuilt, confirmed the new test fails, restored, rebuilt again —
  bundle hashes matched exactly on both sides.
- `pnpm typecheck` (full workspace, Turborepo) — 8/8 tasks pass.
- `pnpm test:e2e` — **54/54 passed** (53 pre-existing + 1 new) on a clean full-suite run, no
  regressions (after fixing the click-timing flake described above).

## Verdict

Small, consistency-driven fix — folder settings now matches the `{{var}}` autocomplete convention
established everywhere else fields of this shape exist. Scoped to `packages/web`; no
backend/core changes, since the underlying data model already supported variable references here —
only the UI's assistance was missing.
