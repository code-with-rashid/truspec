# UX Refinement — Round 2 (2026-08-26)

Continuing from [round 1](ux-round-1-report.md) (fixed the request/response split-pane layout).
This round targets the single biggest remaining gap found while re-checking the request workspace
after round 1's fix.

## Findings

- **Method and URL were static text — the two most-edited fields on any request required opening
  the raw YAML editor to change.**
  - **Where:** [`packages/web/src/components/RequestWorkspace.tsx`](../../packages/web/src/components/RequestWorkspace.tsx)
    (`.url-bar`), [`packages/web/src/styles.css`](../../packages/web/src/styles.css).
  - **Symptom:** Clicking directly on the method badge or the URL text in the request bar did
    nothing — no cursor, no focus, no affordance that they were interactive. Every other field on
    a request (params, headers, body, auth) was already inline-editable via the structured
    workspace; method and URL were the one glaring exception, silently requiring a trip to "✎
    edit" → a full raw-YAML textarea for something as routine as changing `GET` to `POST` or
    fixing a typo'd path segment. This is the single most common action in Postman/Bruno (type a
    URL, pick a method, hit send) and it didn't work at all inline.
  - **Root cause:** `.url-bar` rendered `<span className="m m-{method}">{method}</span>` and
    `<code className="url">{url}</code>` — both plain, non-interactive elements. `onFieldChange`
    (the same callback already used by every other tab) was simply never wired to them.
  - **Fix:** Replaced the static method badge with a real `<select>` (`HTTP_METHODS`: GET, POST,
    PUT, PATCH, DELETE, HEAD, OPTIONS — matching the schema in `packages/core/src/format/schema.ts`)
    and the static URL text with a real `<input>`, both calling the existing `onFieldChange`
    callback per keystroke/selection — exactly the same pattern params/headers already use, so
    dirty-tracking, save/discard, and the tab-strip's unsaved-changes dot all worked immediately
    with no other changes. Kept the method select's color-coded pill styling (`.m-GET`, `.m-POST`,
    etc. — the color updates live as you change the method) and added a matching class for the URL
    input. Pressing **Enter** in the URL input now sends the request, matching Postman/Bruno.
  - **Verification:** In the real browser: clicked the method dropdown and switched `Get post`
    from GET to POST — the pill immediately recolored (cyan→green) and the dirty bar appeared;
    edited the URL text directly, saw the dirty bar and tab-strip dot; clicked discard and
    confirmed both reverted to the on-disk values; changed the method again, clicked save, and
    confirmed no request round-trip error. Confirmed Enter-to-send fires a real request against
    the local mock server.
  - **Regression test:** [`e2e/inline-method-url.spec.ts`](../../e2e/inline-method-url.spec.ts) —
    (1) selects POST via `.method-select`, edits `.url-input`, saves, and asserts the on-disk
    `.tspec.yaml` now contains `method: POST` and the new path; (2) focuses `.url-input` and
    presses Enter, asserting a response pill appears. Proved both fail against the pre-fix code
    (`.method-select`/`.url-input` don't exist — Playwright times out locating them) via the same
    stash/rebuild/run/pop cycle used in round 1, and pass after restoring the fix.

## Verification

- `pnpm --filter @truspec/web typecheck` — pass.
- `pnpm --filter @truspec/web build` — pass.
- `pnpm test:e2e` — **21/21 passed** (19 pre-existing + 2 new), no regressions.

## Verdict

1 high-severity UX gap found and fixed — the core "compose a request" loop now works entirely
inline, matching Postman/Bruno, with the raw YAML editor still available as the power-user escape
hatch for everything else (scripts, exact key ordering, etc.). Continuing to round 3.
