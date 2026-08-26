# UX Refinement — Round 12 (2026-08-26) — visual/typographic pass

The user explicitly greenlit a visual pass after the third checkpoint (rounds 1-11 covered
concrete, evidence-based gaps only). This round is different in kind from the others: a
taste-driven change, not a bug fix — shown with real before/after screenshots rather than just
landed.

## Change

- **The whole UI — nav labels, buttons, request/tab names, dashboard stat numbers, form labels —
  rendered in the monospace font, all the time.** Only a handful of elements (`.docs`, mock-card
  prose) had ever been carved out to use the sans font already bundled
  (`@fontsource/ibm-plex-sans`). Postman and Bruno both reserve monospace for genuinely technical
  strings — URLs, file paths, request/response bodies, code — and use a regular UI font for
  everything else; TruSpec's redesign had never made that split.
  - **Where:** [`packages/web/src/styles.css`](../../packages/web/src/styles.css) (`body`'s
    `font-family`, plus explicit `.url` mono override), [`packages/web/src/main.tsx`](../../packages/web/src/main.tsx)
    (added the `600` sans weight import).
  - **Change:** Flipped `body`'s default `font-family` from `--mono` to `--sans`. Because the
    codebase already wrapped every genuinely technical string in `<code>`/`<pre>` (which already
    had their own `font-family: var(--mono)` rule) or gave it an explicit mono override (the raw
    YAML editor's `.editor-text`, file-path inputs `.path-input`/`.path-fixed`), those needed no
    changes — they kept rendering in mono automatically. The one gap: the URL bar's `.url`/`.url-input`
    is a real `<input>`, not `<code>`, so it was inheriting the (now-sans) body font by default;
    added an explicit `font-family: var(--mono)` rule for it so the most code-like field on the
    page — the URL itself — stays monospace. Deliberately left params/headers/env value inputs
    (`.kv-input`/`.editable-kv-*`) and the method badges (`.m`) as sans, matching how Postman/Bruno
    actually render form-style key/value editors and method chips (bold sans, not code font).
    Added the `600` sans weight import (`@fontsource/ibm-plex-sans/600.css`) alongside the
    already-imported `400`/`500` — without it, the ~26 `font-weight: 600` rules throughout the
    stylesheet (headings, active-tab labels, stat numbers) would have rendered as
    browser-synthesized faux-bold sans instead of the font's real bold weight.
  - **Verification:** Screenshotted the same three surfaces before and after in the real browser
    (opened in the user's own Chrome via the `claude-in-chrome` bridge, so they could also look
    directly): the empty workspace state, an open JSON-body request (`Create post`), and the spec
    dashboard — in both dark and light theme. In every case: nav labels, sidebar entries, tab
    labels, buttons, and dashboard stat numbers now render in the sans font; the URL bar and the
    JSON response/request body stayed monospace, unchanged.
  - **Regression test:** [`e2e/typography.spec.ts`](../../e2e/typography.spec.ts) — asserts a
    request name's computed `font-family` contains "ibm plex sans", and that the URL input's and
    response body's computed `font-family` both still contain "ibm plex mono". The sans assertion
    fails on the pre-fix code (computed family is `"IBM Plex Mono", ...`); the mono assertions were
    already true before this round and stay true after, included so this test doubles as a guard
    against someone accidentally making the URL/body inherit the new sans default later.

## Verification

- `pnpm typecheck` (full workspace) — 8/8 tasks pass.
- `pnpm --filter @truspec/web build` — pass (confirmed the new `600` weight font asset is bundled).
- `pnpm test:e2e` — **40/40 passed** (38 pre-existing + 2 new), including all 4 existing
  accessibility tests (contrast is unaffected — this only changed `font-family`, no colors).

## Verdict

A deliberate, scoped visual change rather than a bug fix — flagged as such and shown with
before/after evidence per the user's own framing when they asked for this round, rather than
landed the way the bug-fix rounds were. Everything else about the app's identity (the dark/light
lime-accented palette, the terminal-adjacent iconography, spacing, layout) is untouched; this is
specifically the code-vs-chrome typography split that both comparison products already make.
