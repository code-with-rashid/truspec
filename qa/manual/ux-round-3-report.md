# UX Refinement — Round 3 (2026-08-26)

Continuing from [round 1](ux-round-1-report.md) (response split pane) and
[round 2](ux-round-2-report.md) (inline method/URL editing).

## Findings

- **Assertions were read-only in the inline workspace — declaring what a passing response looks
  like, the single most basic thing an API client lets you do, required the raw YAML editor.**
  - **Where:** [`packages/web/src/components/RequestWorkspace.tsx`](../../packages/web/src/components/RequestWorkspace.tsx)
    (assert tab), new [`packages/web/src/components/AssertionsEditor.tsx`](../../packages/web/src/components/AssertionsEditor.tsx).
  - **Symptom:** The assertions tab rendered each declared assertion as plain text
    (`<span>{type}</span><code>{describeAssertion(a)}</code>`) with no add/edit/remove controls —
    confirmed against round 4 of the earlier bug-hunting pass (`qa/manual/round-4-report.md`),
    which had noted this as "intentionally read-only" at the time. It's the one tab that didn't
    match the rest of the workspace, where every other field (params/headers/body/auth, and now
    method/URL per round 2) is inline-editable. Postman's "Tests" tab and Bruno's "Assert" tab are
    both fully inline-editable — this was the last major inline-editing gap.
  - **Fix:** Built `AssertionsEditor`, a row-based editor (add/remove via the same `.editable-kv-add`
    / `.row-action-btn.danger` visual pattern as the params/headers editor) with a type selector per
    row (`status | header | jsonpath | body | duration | schema` — the six types from
    `packages/core/src/format/schema.ts`) and type-specific fields that swap in based on the
    selected type:
    - `status`: mode (`equals`/`in`/`lt`/`gte`) + a number input (or a comma-separated list for `in`).
    - `header` / `jsonpath`: a name/path input + mode (`exists`/`equals`/`matches`) + a value input
      that only appears for `equals`/`matches` (an `exists` assertion has no value to type).
    - `body`: mode (`contains`/`matches`) + value.
    - `duration`: a single `ltMs` number input.
    - `schema`: optional `status` number and `contentType` text (the common case is auto-injected
      by `run --spec`, so manual authoring is rare, but still fully supported here).
    - Switching a row's type re-templates it to that type's sensible default (e.g. `status equals
      200`) rather than leaving stale fields from the previous type behind.
    - Wired through the existing `onFieldChange("assertions", next)` — the same callback path
      params/headers/body/auth already use — so dirty-tracking, save/discard, and the tab-strip dot
      all worked immediately with no other plumbing.
  - **Verification:** In the real browser, on `Get post` (2 existing assertions: `status equals
    200`, `jsonpath $.title exists`): confirmed both rendered as editable rows; added a third row,
    retyped it from `status` to `duration` (fields swapped to a single `ltMs` input, defaulted to
    1000), saved, and confirmed the on-disk `.tspec.yaml` gained a well-formed
    `- type: duration\n  ltMs: 1000` entry that still parses/validates (the save endpoint validates
    against the `.strict()` schema, so a malformed shape would have surfaced as a save error, not
    silently corrupted the file). Removed the row and confirmed it round-tripped back out. Restored
    the fixture file via `git checkout` afterward.
  - **Regression test:** [`e2e/assertions-editor.spec.ts`](../../e2e/assertions-editor.spec.ts) —
    adds a row, retypes it to `duration`, sets `ltMs: 500`, saves, and asserts the on-disk file
    contains `duration`/`500`; then removes the row, saves again, and asserts `duration` is gone.
    Proved it fails against the pre-fix code (`.assert-row` doesn't exist yet — the old read-only
    `.assert-def` markup has no such class) via the same stash/rebuild/run/pop cycle as rounds 1–2
    (the new `AssertionsEditor.tsx` file itself was moved aside rather than stashed, since it's
    untracked and `git stash push -- <path>` only stashes tracked paths).

## Verification

- `pnpm --filter @truspec/web typecheck` — pass.
- `pnpm typecheck` (full workspace) — 8/8 tasks pass.
- `pnpm --filter @truspec/web build` — pass.
- `pnpm test:e2e` — **22/22 passed** (21 pre-existing + 1 new), no regressions.

## Verdict

1 high-severity UX gap found and fixed — the request workspace is now consistently inline-editable
across every tab (params, headers, body, auth, method/URL, and now assertions), with the raw YAML
editor remaining as the power-user escape hatch for scripts and anything the structured editors
don't cover. Continuing to round 4.
