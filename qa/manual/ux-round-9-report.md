# UX Refinement — Round 9 (2026-08-26)

Continuing from [round 8](ux-round-8-report.md).

## Findings

- **Theme reset to dark on every load — no memory of a prior toggle, no regard for the OS/browser
  preference.**
  - **Where:** [`packages/web/src/App.tsx`](../../packages/web/src/App.tsx) (`theme` state).
  - **Symptom:** `useState<Theme>("dark")` — every fresh load started dark regardless of what the
    user had picked last time, or what their OS/browser already prefers. Postman and Bruno both
    remember an explicit choice and otherwise default to the system preference.
  - **Fix:** `initialTheme()` reads `localStorage["truspec.theme"]` first; if unset, falls back to
    `window.matchMedia("(prefers-color-scheme: light)")`. The toggle button now persists its choice
    (`setTheme(next)`, default `persist = true`); the existing `?theme=light` deep-link (used for
    demos/CI per its own comment) still works but intentionally does **not** persist
    (`setTheme("light", false)`) — a demo link shouldn't permanently overwrite a real user's saved
    preference.
  - **A real, pre-existing accessibility bug surfaced (and fixed) as a direct consequence:** the
    e2e a11y suite's "editor view" test started failing once the default theme became
    system-dependent instead of a hardcoded dark, because this Chromium/Playwright environment's
    default `prefers-color-scheme` resolves to light — and `.editor-title` (`color: var(--lime)`)
    fails WCAG AA contrast in the light theme (4.34 measured vs. 4.5 required at 10.5px). The
    codebase already had two other instances of exactly this lime-on-light-background problem
    (`.nav-btn.active`, `.rail-tab.active`), each with a comment explaining the fix (swap to
    `var(--text)`); `.editor-title` had simply never been exercised by axe-core under light theme
    before, because every a11y test ran under the old hardcoded dark default except the one
    dedicated "light theme" test, which doesn't visit the editor view. Applied the same established
    fix (`color: var(--text)`, same explanatory comment) — this is a real defect that predates this
    round; round 9 only changed which theme a bare page load starts in, which is what made it
    visible in CI. Left untouched otherwise, since it's out of visual-redesign territory (a plain
    contrast-compliance fix, not a stylistic change).
  - **Verification:** In the real browser: toggled the theme, confirmed `localStorage["truspec.theme"]
    === "light"`; reloaded the page and confirmed it stayed light; cleared the stored key to restore
    a clean baseline for later rounds.
  - **Regression test:** [`e2e/theme-persistence.spec.ts`](../../e2e/theme-persistence.spec.ts) —
    (1) with `prefers-color-scheme: dark` emulated, toggling flips to light, persists to
    `localStorage`, and survives a reload; (2) with `prefers-color-scheme: light` emulated and no
    stored preference, the app starts light. Both fail on the pre-fix code (no persistence, no
    system-preference read) via the same stash/rebuild/run/pop cycle as prior rounds.

## Verification

- `pnpm typecheck` (full workspace) — 8/8 tasks pass.
- `pnpm --filter @truspec/web build` — pass.
- `pnpm test:e2e` — **34/34 passed** (32 pre-existing + 2 new), including the a11y suite's
  previously-newly-broken "editor view" test, now fixed alongside the theme change that exposed it.

## Verdict

1 gap fixed (theme persistence + system default), plus 1 real accessibility bug fixed that the
change surfaced. Continuing to round 10.
