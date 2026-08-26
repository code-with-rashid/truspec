# UX Refinement — Round 4 (2026-08-26)

Continuing from [round 1](ux-round-1-report.md) (response split pane), [round 2](ux-round-2-report.md)
(inline method/URL), and [round 3](ux-round-3-report.md) (inline assertions editor). With the
workspace's editing surfaces now consistent, this round targets keyboard efficiency and response
inspection — both baseline expectations set by Postman/Bruno that were entirely absent.

## Findings

- **No keyboard shortcut to send or save from the inline request workspace, and no way to copy a
  response.**
  - **Where:** [`packages/web/src/components/RequestWorkspace.tsx`](../../packages/web/src/components/RequestWorkspace.tsx).
  - **Symptom:** The raw YAML editor already supports `Ctrl/Cmd+Enter` to save (from round 1-6's
    bug-hunting pass, BUG-O), but the inline request workspace — where users spend most of their
    time — had no equivalent. Sending required a mouse click on "▶ send"; saving a dirty request
    required a mouse click on "save" in the dirty bar. Round 2 added `Enter`-to-send in the URL
    input specifically, but that only worked while that one field was focused. Separately, reading
    a response body or headers and getting it into another tool (a bug report, a curl command, a
    test assertion) required manually selecting and copying text from inside the (possibly
    scrolled) JSON block — no one-click copy, unlike both Postman and Bruno.
  - **Fix:**
    - Added a `Ctrl/Cmd+Enter` → send and `Ctrl/Cmd+S` → save (when dirty) handler on the `.reqview`
      root via React's bubbling `onKeyDown`, so either shortcut works from anywhere inside the
      request workspace — params/headers/body/auth/script/assertions tabs, not just the URL input.
      Tightened the existing URL-input Enter-to-send handler to ignore `Ctrl`/`Cmd`-modified Enter
      so the two handlers don't both fire (double-send) when Ctrl+Enter is pressed while the URL
      input has focus.
    - Added a **copy** button next to the response's body/headers tab strip that copies whichever
      is currently showing (`navigator.clipboard.writeText`) with a transient "copied ✓" label
      (reverts after 1.2s). Silently no-ops if the Clipboard API is unavailable/denied — there's
      nothing more useful to do in that case, and the button doesn't claim success it can't verify.
    - Added `title` hints on the send/save buttons documenting the shortcuts, matching how "edit
      YAML source" already has one.
  - **Verification:** In the real browser: switched focus to a tab button (not the URL input),
    pressed Ctrl+Enter, and confirmed via the mock server's own request log that a second `GET
    /posts/1` request landed (proving the shortcut fired from a non-URL focus target, not just
    re-testing round 2's URL-specific handler). Edited the URL, pressed Ctrl+S, and confirmed via
    the on-disk file that it saved (dirty bar cleared). Sent a request, clicked "copy", and
    confirmed via `document.body.innerText` that the button's label flipped to "copied ✓".
  - **Regression test:** [`e2e/keyboard-and-copy.spec.ts`](../../e2e/keyboard-and-copy.spec.ts) —
    three tests: Ctrl+Enter from a non-URL focus target reaches a response; Ctrl+S saves a dirty
    URL edit and the on-disk file reflects it; the copy button (with clipboard permissions granted
    via Playwright's `context.grantPermissions`) flips to "copied ✓" and
    `navigator.clipboard.readText()` returns the response body. Proved all three fail against the
    pre-fix code via the same stash/rebuild/run/pop cycle as prior rounds.

## Verification

- `pnpm typecheck` (full workspace) — 8/8 tasks pass.
- `pnpm --filter @truspec/web build` — pass.
- `pnpm test:e2e` — **25/25 passed** (22 pre-existing + 3 new), no regressions.

## Verdict

1 gap found and fixed, bundling two related, low-risk affordances (keyboard shortcuts + copy) that
both round out the request/response loop rounds 1-3 already made structurally sound. Continuing to
round 5.
