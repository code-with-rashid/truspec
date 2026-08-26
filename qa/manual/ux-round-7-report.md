# UX Refinement — Round 7 (2026-08-26)

First round in more speculative territory, per the user's explicit choice after the round 6
checkpoint (concrete Postman/Bruno parity gaps vs. more subjective additions). This round: `{{var}}`
autocomplete, a standard convenience in both tools that TruSpec had no equivalent of.

## Findings

- **No `{{var}}` autocomplete anywhere — typing `{{` in the URL bar did nothing beyond inserting
  plain text.**
  - **Where:** new [`packages/web/src/components/VarAwareInput.tsx`](../../packages/web/src/components/VarAwareInput.tsx),
    wired into the URL input in
    [`packages/web/src/components/RequestWorkspace.tsx`](../../packages/web/src/components/RequestWorkspace.tsx);
    the active environment's variable names are fetched in
    [`packages/web/src/App.tsx`](../../packages/web/src/App.tsx) (`getEnvironment(env)`, already
    used by `EnvironmentModal`) and passed down as `envVarNames`.
  - **Fix:** `VarAwareInput` wraps a plain input with `{{`-trigger detection: scanning backward
    from the caret for the nearest unclosed `{{`, and — while suggestions exist and none has been
    closed with `}}` yet — showing a filtered dropdown of the environment's declared variable and
    secret names. Enter/Tab/click inserts the full `{{name}}`, Escape or an outside click dismisses
    it, arrow keys navigate. Scoped to the URL input only for this round (the highest-traffic
    single field) rather than every params/headers/body input, to keep the change reviewable.
  - **A real bug found and fixed during this round, not just the feature:** the dropdown initially
    rendered but was never visible. Traced by inspecting the live DOM (`getBoundingClientRect` on
    `.var-suggest` showed a correctly-sized, in-viewport box, but `elementFromPoint` at that
    location returned `.reqview-top`, i.e. nothing was actually painted there) to `.url-bar`
    having `overflow: hidden` — intentional, so the URL input's square corners don't poke out past
    the pill's rounded border — which also silently clips any absolutely-positioned descendant,
    including a dropdown meant to escape the input's own box. Fixed by rendering the suggestion
    list `position: fixed` with its position computed from the input's own `getBoundingClientRect()`
    in JS rather than relying on CSS `position: absolute` + a positioned ancestor, which escapes
    the clipping entirely (confirmed no ancestor in the chain sets `transform`/`filter`, either of
    which would re-introduce a containing block that `position: fixed` can't escape). The dropdown
    closes on scroll of any ancestor rather than trying to track a moving target, since it's only
    open for the few keystrokes it takes to pick a suggestion.
  - **Verification:** In the real browser, on `Get post` (env `local`: `baseUrl`, `postId`): typed
    `{{p` — dropdown showed only `{{postId}}` (correctly filtering out `baseUrl`); clicked it and
    confirmed the URL text updated with the full token and the cursor landed right after it.
    Confirmed dismissal (Escape, non-matching query) and that switching environments would refetch
    the suggestion list (via the `env` dependency on the fetch effect — not separately screenshotted
    since this workspace's fixture only has one environment, but the code path is the same
    `getEnvironment` call `EnvironmentModal` already exercises for a different environment).
  - **Regression test:** [`e2e/var-autocomplete.spec.ts`](../../e2e/var-autocomplete.spec.ts) —
    (1) typing `{{ba` shows exactly one suggestion (`{{baseUrl}}`) and clicking it inserts the full
    token; (2) typing a non-matching partial shows zero suggestions. Both fail on the pre-fix code
    (`.url-input`/`.var-suggest-item` don't exist) via the same stash/rebuild/run/pop cycle as
    prior rounds.

## Verification

- `pnpm typecheck` (full workspace) — 8/8 tasks pass.
- `pnpm --filter @truspec/web build` — pass.
- `pnpm test:e2e` — **30/30 passed** (28 pre-existing + 2 new), no regressions.

## Verdict

1 feature gap found and fixed, plus one real clipping bug caught and fixed along the way (the
dropdown would have shipped invisible without the DOM-level investigation). Continuing to round 8.
