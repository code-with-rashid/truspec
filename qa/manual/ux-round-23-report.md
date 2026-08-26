# UX Refinement — Round 23 (2026-08-26) — the schema assertion's `required` flag was unreachable

Continuing from [round 22](ux-round-22-report.md). A narrower finding than recent rounds: the
`schema` assertion's inline editor was mostly complete (rounds 3's original assertions editor
already covered `status`/`contentType`), but missing one documented, behavior-changing field.

## Finding: no way to set `required: true` on a schema assertion

- **Where:** [`packages/web/src/components/AssertionsEditor.tsx`](../../packages/web/src/components/AssertionsEditor.tsx)
  (`SchemaFields`), [`packages/web/src/styles.css`](../../packages/web/src/styles.css).
- **Symptom:** CLAUDE.md documents the `schema` assertion as taking optional `status` /
  `contentType` / `required` fields. `SchemaFields` exposed inputs for the first two but not
  `required` at all — and it's not a cosmetic omission: per
  `packages/core/src/runner/assertions.ts`, a response whose status the linked OpenAPI spec doesn't
  document is silently **skipped** (counted as passing) by default; `required: true` makes that
  same case **fail** instead. A genuine strictness toggle a user might reasonably want when
  tightening up contract tests, reachable only via the raw YAML editor.
- **Fix:** Added a `required` checkbox next to the existing status/content-type fields, matching
  the visual weight of the row's other inputs. Unchecking it clears the field entirely
  (`required: e.target.checked || undefined`) rather than writing `required: false`, keeping saved
  YAML minimal — the field's absence and `false` are behaviorally identical per the assertion
  evaluator, so there's no reason to ever write the false case explicitly.
- **Verification:** In the real browser: added a schema assertion, checked "required", saved, and
  confirmed the file gained `required: true` under the assertion.
- **Regression test:** [`e2e/schema-assertion-required.spec.ts`](../../e2e/schema-assertion-required.spec.ts)
  — adds a schema assertion, checks `required`, saves, asserts the on-disk file contains
  `required: true`; reloads the page and re-opens the same request/tab to confirm the checkbox
  state survives a full round-trip from disk, not just the in-memory draft. Ran 3x clean before the
  pre-fix check. **Failed on the pre-fix code** (no `.assert-required` checkbox exists) — confirmed
  by reverting this round's two changes (`AssertionsEditor.tsx` is untracked — round 3's own new
  file, never committed — so `git stash` wouldn't touch it either way; hand-reverted alongside
  `styles.css`, which does carry prior rounds' history), rebuilding — bundle hashed identically to
  the round-22 build — then restoring and rebuilding again, matching the round-23 build's hashes
  exactly.

## A note on the investigation, not the fix

While confirming `required`'s actual behavior before building the UI for it, an early manual test
in the real browser produced a confusing result: after adding a new assertion row and switching its
type to `schema`, the saved file showed only 2 assertions where 3 were expected (the fixture's
original `jsonpath` assertion had apparently been overwritten rather than a third row added). Traced
to a timing race in the *manual test script* — a single batched JS call switched to the assertions
tab and clicked "+ add" without waiting for the tab's own render to complete, so the click landed on
a stale query result. Not a product bug: confirmed by re-testing with proper Playwright waits (used
in the actual regression test above), which passed cleanly and round-tripped correctly. Mentioned
here only because it's the second round in a row (after round 21's `Grep`-rendering false alarm)
where a manual verification artifact looked like a bug before turning out not to be — worth staying
skeptical of "the test/tool showed something wrong" until double-checked against a clean, properly
awaited interaction.

## Verification

- Hand-reverted, rebuilt, confirmed the new test fails, restored, rebuilt again — bundle hashes
  matched exactly on both sides.
- `pnpm typecheck` (full workspace, Turborepo) — 8/8 tasks pass.
- `pnpm test:e2e` — **57/57 passed** (56 pre-existing + 1 new), no regressions.
- Manually tested in the live app; the on-disk test artifact was restored via `git checkout`
  afterward — confirmed clean via `git status --short examples/`.

## Verdict

Small, targeted fix closing the last gap in an editor that was otherwise already complete. Scoped
to one component and one CSS block; no backend/core changes.
