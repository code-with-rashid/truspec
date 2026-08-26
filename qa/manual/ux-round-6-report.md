# UX Refinement — Round 6 (2026-08-26)

Continuing from [round 1](ux-round-1-report.md) through [round 5](ux-round-5-report.md). With every
field of an *existing* request now inline-editable (rounds 2-3) and the request/response loop
efficient (rounds 1, 4-5), this round closes the one remaining inconsistency: *creating* a request.

## Findings

- **Creating a request always meant opening a blank raw-YAML file, even after rounds 1-5 made
  editing an existing request fully inline.** Postman/Bruno's basic flow is "click +, type a name,
  start editing" — TruSpec's was "click +, write YAML by hand."
  - **Where:** new [`packages/web/src/components/NewRequestModal.tsx`](../../packages/web/src/components/NewRequestModal.tsx),
    wired into [`packages/web/src/App.tsx`](../../packages/web/src/App.tsx).
  - **Fix:** Added a guided "new request" modal (name / method / path, with the path
    auto-slugified from the name until the user edits it directly) as the **new default** for the
    sidebar's "+ new" button and the empty-state's "+ new request" button. On create, it writes a
    small starter file (`name`, `method`, `url: "{{baseUrl}}/path"`, one `status equals 200`
    assertion) via the same `saveRequestObject` endpoint the inline editor's save button already
    uses, then opens it as a tab — landing the user directly in the now fully inline-editable
    workspace from rounds 1-3, exactly matching the modal's own "editable right after" hint.
    Deliberately did **not** replace the sidebar's original raw-YAML "+ new" button — it's still
    there, relabeled "+ yaml" (same CSS class `.new-request`, same `openNew()` handler, completely
    unchanged) as the power-user path for anyone who wants to author the file directly, consistent
    with this project's plain-text-first philosophy (CLAUDE.md). This also avoided touching
    `e2e/editor.spec.ts`'s five existing tests, all of which depend on `.new-request` opening the
    raw editor immediately.
  - **Verification:** In the real browser: clicked "+ new", typed "Delete Post", watched the path
    field auto-fill to `delete-post.tspec.yaml`, switched the method to DELETE, clicked create —
    confirmed the file appeared on disk with valid, schema-conformant YAML
    (`name: Delete Post` / `method: DELETE` / starter `url`/`assertions`), and that it opened as a
    new tab already showing the DELETE method (correctly color-coded) and the starter assertion,
    fully editable via every surface from rounds 1-3. Cleaned up the test file afterward via `rm`
    + `git status` to confirm the fixture directory was left clean.
  - **Regression test:** [`e2e/new-request-modal.spec.ts`](../../e2e/new-request-modal.spec.ts) —
    two tests: (1) the guided modal creates a valid file, opens it as a tab, and its method select
    shows the chosen value; (2) `.new-request` (the original button) still opens the raw
    `Editor` directly with no modal involved, proving the power-user path is untouched. Proved (1)
    fails on the pre-fix code (`.new-request-quick` doesn't exist) while (2) *passes unchanged*
    against that same pre-fix code — direct evidence the original flow was never touched — via the
    same stash/rebuild/run/pop cycle as prior rounds.

## Verification

- `pnpm typecheck` (full workspace) — 8/8 tasks pass.
- `pnpm --filter @truspec/web build` — pass.
- `pnpm test:e2e` — **28/28 passed** (26 pre-existing + 2 new), no regressions.

## Verdict

1 gap found and fixed, closing the last major inconsistency between "creating" and "editing" a
request. Across rounds 1-6: the request/response view is now a real docked split (round 1),
method/URL/assertions are all inline-editable (rounds 2-3), the workspace has keyboard shortcuts
and one-click response/curl copying (rounds 4-5), and creating a request no longer requires raw
YAML by default (round 6) — while the raw-YAML power-user path remains fully intact throughout.
This is a natural checkpoint: the concrete, evidence-based gaps found by direct comparison against
Postman/Bruno's core request-building loop have been addressed. Further rounds from here would
move into more subjective territory (visual redesign, onboarding, feature parity like a persistent
cross-session history view) rather than clear-cut usability defects.
