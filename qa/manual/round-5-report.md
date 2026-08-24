# Manual E2E QA — Round 5 (2026-08-23)

Continuing from [round 4](round-4-report.md). This round covers folder-level duplicate/delete
(vs. round 1's request-level duplicate/rename), editing an *existing* environment's values (round
1 only covered creating and deleting one), and the mock server's request validation against
undefined routes — the one specific claim ("✓ request validation") from the mock panel's feature
list that hadn't been exercised yet.

Setup unchanged: `truspec serve --dir examples/blog`, real Chromium via the Browser pane.

## Findings

None this round.

## Investigated, no bug found

- **Duplicate folder** — `posts` → `posts-copy`, correctly copied all 3 requests inside it.
- **Delete folder (nested)** — deleting `posts-copy` showed the confirm dialog with the accurate
  count ("Delete \"posts-copy\" and 3 requests inside it?"); confirming removed the whole directory
  in one operation, nothing left behind.
- **Editing an existing environment** — opened `local`'s ✎ edit, confirmed `baseUrl`/`postId` were
  correctly pre-populated from disk, changed `postId` to `42`, saved, and confirmed the file
  updated correctly on disk. Reverting it back to `1` round-tripped correctly too. Noted (not a
  bug): saving through this modal re-serializes the whole file canonically — an untouched
  `baseUrl: "http://localhost:4000"` came back unquoted, and an empty `secrets: []` got added even
  though the source file omitted it. Both are functionally inert (valid YAML, same resolved value,
  schema field is optional) and this is deterministic, expected serializer behavior, not
  corruption — but it does mean editing one field in this modal cosmetically touches the whole
  file. Restored the file via `git checkout` rather than by hand to guarantee it matched the
  original byte-for-byte.
- **Mock server request validation** — a request to an undefined route (`GET
  /not-a-real-route`) against the running mock correctly returned `404` with a clear
  `{"error": "No mock for GET /not-a-real-route"}` body, and the mock's request log recorded it
  with the documented "a 404 means request validation rejected a call that doesn't match the spec"
  explanation directly underneath. (Direct cross-origin `fetch()` from the page's own JS console to
  the mock's port failed outright — expected, since the app's own requests always execute
  server-side through `@truspec/core`, not via the browser's `fetch`, precisely to avoid CORS; this
  isn't a code path the real UI ever uses, so it isn't a finding.)

## Verification

- No code changes this round. `pnpm test:e2e` unchanged at 17/17 (not re-run since nothing in the
  web package changed).
- All artifacts from this round's manual exploration (`posts-copy/` folder, a `postId` edit and
  revert, a `qa-mock-validation-test.tspec.yaml` probe request) were removed; `git status` on
  `examples/blog` confirmed clean before wrapping up.

## Verdict

0 bugs found this round. This is round 5 — the **second of the 3 consecutive clean rounds** needed
to meet the stop condition. Continuing to round 6 for the final confirmation pass.
