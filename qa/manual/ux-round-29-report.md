# UX Refinement — Round 29 (2026-08-26) — no way to save a response to a file

Continuing from [round 28](ux-round-28-report.md). Back to this session's usual "missing UI"
pattern: the response panel's only export path was the clipboard.

## Finding: "copy to clipboard" was the only way to get a response body out of the app

- **Where:** [`packages/web/src/components/RequestWorkspace.tsx`](../../packages/web/src/components/RequestWorkspace.tsx)
  (`downloadResponse`, the response toolbar).
- **Symptom:** The response panel's toolbar had a single "copy" button. For a short JSON reply
  that's fine; for anything large, or content a paste could silently mangle (binary-ish text,
  content with embedded control characters), there was no alternative. Postman and Bruno both offer
  "save response" as a standard, adjacent action to copy.
- **Fix:** Added a "⇩ save" button next to "copy" that builds a `Blob` from the same raw
  `result.response.bodyText` the copy button already uses (not the pretty-printed display —
  consistent with what copy already does), picks a file extension from the response's own
  `content-type` header (json/html/xml, falling back to txt), and names the file after the request
  (slugified). Used the standard "append the `<a download>` to the DOM before the synthetic click"
  pattern — some browsers only honor a programmatic download click on an anchor that's actually
  attached to the document.
- **Verification:** In the real browser (with the mock server running to get a real response):
  sent a request, clicked "⇩ save", confirmed a `get-post.json` file downloaded with the correct
  response content — verified end-to-end, not just that the button exists.
- **A dead-end test approach, and what fixed it:** the first regression test used Playwright's
  `page.waitForEvent("download")`, which never fired in this environment even though the download
  demonstrably works in a real browser (manually confirmed above) — a blob-URL download from a
  synthetic anchor click appears not to reliably surface as a trackable Playwright download event
  here, independent of whether the app code is correct. Rather than chase an environment quirk
  unrelated to what this round actually changed, rewrote the test to capture the *inputs* to that
  same download mechanism directly: monkey-patching `URL.createObjectURL` and
  `HTMLAnchorElement.prototype.click` inside the page (restored immediately after) to intercept the
  Blob content and the anchor's `download` filename without needing the browser's download pipeline
  to complete — verifying exactly the code this round added (filename, content-type, and body
  content) without depending on a flaky signal for something that isn't actually flaky.
- **Regression test:** [`e2e/response-download.spec.ts`](../../e2e/response-download.spec.ts) —
  sends a request, intercepts the save button's blob/filename as above, and asserts the filename is
  `get-pet.json`, the blob's MIME type contains "json", and its parsed content structurally matches
  the displayed (pretty-printed) response body. Ran 3x clean before the pre-fix check. **Failed on
  the pre-fix code** (`captured.download` was `""` — no button, no click, nothing to intercept) —
  confirmed by hand-reverting this round's change in `RequestWorkspace.tsx` (carries many prior
  rounds' history, so hand-reverted rather than stashed), rebuilding — bundle hashed identically to
  the round-28 build — then restoring and rebuilding again, matching the round-29 build's hashes
  exactly.

## Verification

- Hand-reverted, rebuilt, confirmed the new test fails, restored, rebuilt again — bundle hashes
  matched exactly on both sides; re-ran the test standalone to confirm it passes with the fix
  restored.
- `pnpm typecheck` (full workspace) — passes.
- No on-disk test artifacts from manual verification (the actual downloaded file in this case
  lands in the browser's own Downloads location, outside the workspace directory the app manages —
  confirmed `git status --short examples/` stays clean).

## Verdict

A small, concrete addition matching an established convention in comparable tools. Scoped to one
component; no backend/core changes — everything needed (the raw body text, the response headers)
was already available client-side.
