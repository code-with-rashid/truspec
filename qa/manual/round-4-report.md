# Manual E2E QA — Round 4 (2026-08-23)

Continuing from [round 1](round-1-report.md), [round 2](round-2-report.md), and
[round 3](round-3-report.md), which together covered workspace CRUD, the raw-YAML editor,
environments, the mock server, import, resizable panels, tab lifecycle, and spec-view error
handling. This round exercises the parts of the per-request inline editor not yet touched: the
body editor across its content types, the discard/save dirty-state pair for inline field edits,
the auth-scheme editor's non-bearer schemes, the declarative assertions display, and the "runs"
history tab in the right rail.

Setup unchanged: `truspec serve --dir examples/blog`, real Chromium via the Browser pane.

## Findings

None this round.

## Investigated, no bug found

- **Body editor, JSON type** — live-parses on every keystroke (`BodyEditor.tsx`'s
  `JsonTextEditor`); typing invalid JSON shows "invalid JSON — not applied" inline and correctly
  does **not** propagate to the draft (confirmed no `dirty`/save-discard pair appeared for the
  invalid edit, only for a subsequent valid one) — so a syntax error mid-edit can never silently
  corrupt the saved body.
- **Inline dirty-state discard** — made a real (valid JSON) inline body edit, confirmed the
  `discard`/`save` button pair appears only while dirty, and `discard` reverted the textarea to
  the exact on-disk content (not a blank or default value).
- **Body type switching** (the `<select aria-label="body type">` — none/json/text/form/graphql) —
  matches the schema's `Body` union from `packages/core/src/format/schema.ts`; each type's editor
  (JSON textarea, plain textarea, key/value rows for form, query+variables for graphql) rendered
  correctly for the existing `Create post` request (json).
- **Auth scheme editor, non-bearer schemes** — switching an existing request's own auth to
  `apikey` correctly revealed `name`/`value`/`in (header|query)` fields (bearer's `token` field
  was covered via the folder-settings modal in round 2). Discarded before saving.
- **Declarative assertions tab** — confirmed by reading `RequestWorkspace.tsx` that this tab is
  intentionally **read-only** in the inline workspace (no add/edit/remove controls; editing an
  assertion requires the raw-YAML editor). This resolves an ambiguity from round 1's report, which
  described seeing "assertions … + add" in flattened page text — that "+ add" belongs to whichever
  `EditableKV`-backed tab (params/headers/form-body) happens to be active by default, not to
  assertions; the two labels just landed adjacent to each other once flattened to plain text. Not
  a bug — recorded here so it isn't re-investigated as one.
- **"Runs" tab (right rail)** — starts as "nothing run yet." with a `▶ run collection` shortcut;
  running the collection (against no mock — baseUrl unreachable) correctly showed "0 passed · 3
  failed" with a per-request ✗ row for each; clicking a row opened that request's tab.

## Verification

- No code changes this round — investigation only, so no build/typecheck/test run was needed
  beyond confirming the environment was still in the state left by round 3 (`pnpm test:e2e` at
  17/17, unchanged).
- All inline edits made during exploration (JSON body test, auth scheme test) were discarded via
  the app's own `discard` button before moving on; `git status` on `examples/blog` confirmed no
  file changes leaked to disk.

## Verdict

0 bugs found this round — the inline editor's body/auth/assertions/runs surfaces all behaved
correctly, including proper isolation of invalid mid-edit input from the saved state. This is
round 4, and the **first of the 3 consecutive clean rounds** needed to meet the stop condition
(round 3 found a real bug, so the streak restarted there). Continuing to round 5.
