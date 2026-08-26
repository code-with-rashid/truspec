# UX Refinement — Round 21 (2026-08-26) — the mock server's "configurable latency" was unreachable

Continuing from [round 20](ux-round-20-report.md). Surveyed the mock server view for gaps and
found one where the UI actively advertises a capability it has no way to actually use.

## Finding: "✓ configurable latency" was a static claim — no UI, and no server plumbing, to configure it

- **Where:** [`packages/web/src/api.ts`](../../packages/web/src/api.ts) (`mockStart`),
  [`packages/web/server/api.ts`](../../packages/web/server/api.ts) (`/api/mock/start` handler),
  [`packages/web/src/App.tsx`](../../packages/web/src/App.tsx) (`MockView`, `doMockStart`).
- **Symptom:** The mock view's feature list has always shown `✓ configurable latency` as a static
  chip alongside `✓ request validation` and friends. That's a real, working feature — the CLI
  genuinely supports `truspec mock --delay <ms>` (`packages/cli/src/commands/mock.ts`), and
  `packages/core/src/mock/server.ts`'s `startMockServer` already accepts a `delayMs` option and
  applies it (`setTimeout(send, delayMs)`). But the web UI's `mockStart(spec, port)` never sent a
  delay value, and the web server's own `/api/mock/start` handler never read one from the request
  body or forwarded one to `startMockServer` either — so the claimed feature was reachable from the
  CLI but completely unreachable from the UI that advertises it, not even from the raw YAML/API
  layer underneath it.
  - **A false alarm along the way, worth noting:** while investigating this, a `Grep` tool call's
    rendered output displayed `"/api/mock/start"` with its forward slashes shown as backslashes
    (`"\api\mock\start"`), which — read literally as a JS string escape — would evaluate to the
    broken string `"apimockstart"` (confirmed with a quick `node -e` check). Before writing that up
    as a critical routing bug, checked the actual file with `Read` (not `Grep`'s `-A` context
    rendering) and confirmed the real source has correct forward slashes throughout; then confirmed
    empirically in the real browser that starting the mock server already worked correctly. A
    reminder to verify anything Grep's context display shows as suspicious against the file
    directly before trusting it, rather than trusting a search tool's rendering.
- **Fix:** Threaded `delayMs` all the way through: `mockStart(spec, port, delayMs)` in the client
  API; the web server's `/api/mock/start` handler now reads and validates `delayMs` from the body,
  stores it on the mock's server-side state, forwards it to `startMockServer`, and echoes it back
  in status responses (`MockStatusJson`/`MockStatus` both gained a `delayMs` field, so the UI can
  show the actual running value, not just what was last typed). Added a "latency" number input
  next to the start button (shown only while stopped, matching how the port number is only shown
  while running) with a live-updating `$ truspec mock --spec ... --port ... --delay ...` preview
  line that only includes `--delay` when non-zero — mirroring the actual CLI invocation exactly.
  While running, the port badge gains a sibling `"Xms delay"` badge.
- **Verification:** In the real browser: set latency to 300ms, confirmed the command preview
  updated to include `--delay 300`; started the server, confirmed the running state showed
  "300ms delay"; timed a real `curl` request against the mock server's port and measured ~570ms
  (matching the 300ms delay plus normal overhead, versus mock responses that are otherwise
  near-instant) — confirming the delay is a genuine server-side effect, not just a UI label.
- **Regression test:** [`e2e/mock-latency.spec.ts`](../../e2e/mock-latency.spec.ts) — sets a
  200ms latency, starts the mock server, asserts the command preview and running-state badge both
  reflect it, then makes a real `fetch()` against the mock server's actual port and asserts the
  response took at least 180ms (a genuine, timed HTTP round-trip through the real server process,
  not a UI-only check) — the strongest kind of assertion available for a feature whose entire point
  is a real timing effect. **Failed on the pre-fix code** (`.mock-delay-field input` never renders)
  — confirmed by stashing the two `api.ts` files (each file's *entire* diff since `HEAD` was exactly
  this round's change, confirmed via `git diff --stat` before stashing — safe to stash outright)
  and hand-reverting `App.tsx`/`styles.css`'s changes (both carry many prior rounds' history, so
  stashing them outright would revert more than this round, per the [round 16](ux-round-16-report.md)
  lesson), rebuilding the whole web package (client + server + sidecar, since this round touches
  the server layer) — confirmed the pre-fix build 30-second-timed-out waiting for the latency
  input — then restoring and rebuilding again.

## Verification

- Stashed/hand-reverted per above, rebuilt the full `pnpm --filter @truspec/web build` (client,
  server, and sidecar — needed since this round changes `packages/web/server/api.ts`, not just
  client code), confirmed the new test fails, restored everything, rebuilt again.
- `pnpm typecheck` (full workspace, Turborepo) — 8/8 tasks pass.
- `pnpm test:e2e` — **55/55 passed** (54 pre-existing + 1 new), no regressions.

## Verdict

A feature the app already claimed to have, made real. Touches `packages/web`'s own thin server
layer (not `packages/core` or `packages/cli`, which already had full support) — the smallest
possible change that closes the gap between what the UI promises and what it can actually do.
