# qa/QA_LOG.md — measured QA loop (v2)

This is the v2 (measurement-driven) continuation. The exhaustive narrative history of **10 prior
adversarial campaigns (16 bugs A–P found and fixed, 206→243 tests)** lives in the repo-root
[`QA_LOG.md`](../QA_LOG.md). This file logs the v2 cycles that drive objective convergence
(coverage / mutation / fuzz thresholds) on top of that already-hardened baseline.

Persistent state (read on startup, write on every RECOMPUTE):
- `qa/INVENTORY.md` — code-derived testable inventory (Phase 0).
- `qa/COVERAGE.json` — line/branch/mutation/fuzz state vs thresholds.
- `qa/TRIED.jsonl` — append-only ledger of executed attacks (never repeat a passing entry).
- `qa/SEEDS.json` — every PRNG seed used (reproducibility).
- `qa/corpus/` — persisted fuzz corpus (grows across runs).

## Starting point (this run)
- Baseline coverage measured: **lines 86.93% (target 90), branches 79.06% (target 85)**, functions 96.25%.
- 243 tests green, deterministic. Build 5/5, typecheck 7/7.
- Frontier = the 0%/low-branch files (see COVERAGE.json `frontier`). Bugs A–P already fixed with
  regression tests, so the engine/runner/spec modules are already 90%+; the deficit is concentrated in
  the **CLI command wrappers, the serve command, the web client api, and the VS Code extension entry**.

## Cycle v2-1 — close the coverage frontier
(in progress — see entries below)

### Findings (cycle v2-1)
- **No new product bugs** — the engine was already hardened by campaigns 1–10 (16 bugs A–P). This cycle
  is about *measured* coverage of the tests themselves, and it surfaced **test gaps**, not code bugs.
- **Coverage frontier closed** (+69 tests, 243→312):
  - 0%→covered: `vscode/src/extension.ts` (vscode-mock test, 10 cases), `cli/src/commands/serve.ts`
    (3), `web/src/api.ts` (6 fetch-stub).  Excluded pure-type `format/types.ts` (justified).
  - branch lifts: CLI commands (13 error/flag/--json/--live/--min tests), output formatters (6),
    Postman importer (6, all auth/body/url variants), mock `generateExample`/`pickResponse` (10).
  - Result: **lines 86.93→95.18%**, **branch 79.06→86.52%** — both ≥ threshold.
- **Mutation (Stryker 9.6.1) on the contract validator**: first run 74.9% (incl. 37 no-coverage) with
  54 survivors → added 10 exact-message/path/edge tests (`validate-response-mutation.test.ts`) →
  **85.4%** (300 killed, 52 survived, noCov 37→1). Survivors reviewed: ~18 equivalent (memoization &
  depth-arithmetic that don't change observable output), rest low-value boundary/message conditionals.
- **Fuzz persisted**: committed `packages/core/test/fuzz.test.ts` (5 seeded invariant targets,
  deterministic, ~11s) replaces the campaigns' scratch harnesses; seeds in `SEEDS.json`, historical
  crash inputs in `qa/corpus/crashes.jsonl`.

### Cycle outcome — coverage + mutation thresholds MET. Confirmation: seeded fuzz green; deterministic.

---

# FINAL SUMMARY (v2 — measured)

**Verdict.** On top of 10 prior adversarial campaigns (16 bugs fixed), this run made the suite
**measurably strong** and **resumable**. Confidence: high for the core engine/CLI/spec/mock/runner
(coverage + mutation proven); the web UI and load/SLO surfaces are partially measured (browser e2e +
throughput need CI infra).

**Measured numbers (qa/COVERAGE.json):**
- Tests: **312** (was 243), deterministic, 36 files green; build 5/5, typecheck 7/7.
- **Line/Statement coverage: 95.18%** (2966/3116) — threshold 90 ✓
- **Branch coverage: 86.52%** (1220/1410) — threshold 85 ✓
- **Mutation score: 85.4%** on `validate-response.ts` (the most security-critical module; 300 killed /
  52 survived) — threshold 80 ✓. Full-repo mutation = scheduled CI job (796 mutants for 3 modules alone).
- **Fuzz:** 5 committed seeded invariant targets (no crash/hang/data-loss) + ~505k cumulative campaign
  execs; corpus persisted. 1M-exec/30-min budget = scheduled continuous-fuzz job (honest gap inline).

**Bugs found this cycle:** 0 product bugs (engine already hardened). Found & fixed **test/coverage
gaps** (un-exercised CLI error paths, importer variants, the entire VS Code extension entry, the web
client api) — i.e. the suite was *decorative* over those areas; it now exercises them.

**Top systemic improvement:** the VS Code extension (`activate` + all commands + CodeLens) went from
**0% → 90%+** via a `vscode` module mock — previously a completely untested public surface.

**Residual risk & honest gaps:**
- **Mutation measured on 1 module**, not the whole repo (time). The validator is the riskiest; the rest
  rely on coverage + the fuzz invariants. → scheduled full-repo Stryker job (config ready, `ignoreStatic`).
- **Continuous fuzzing** to 1M execs/target not run inline (vitest isn't a coverage-guided fuzzer). →
  scheduled libFuzzer/jazzer-style job seeded from `qa/corpus/`.
- **Throughput-to-SLO load test** not run (no SLO defined for a local-first CLI). Load/soak/leak *were*
  verified (campaign 5). → if an SLO is set, add a k6/autocannon gate.
- **Web UI** unit-coverage excluded (`.tsx` not in coverage; no DOM env). Verified via Playwright+axe
  (campaigns 7–10, BUG-M/N/O/P). → Playwright e2e CI job.
- Remaining validator mutants (52): ~18 equivalent (justified), rest low-value.

**Why a re-run is cheap:** `qa/INVENTORY.md` (full testable map), `qa/COVERAGE.json` (thresholds + current
state), `qa/TRIED.jsonl` (28 executed attacks — never repeated), `qa/SEEDS.json` (all seeds),
`qa/corpus/` (crash regressions). A re-run loads these, sees thresholds met, and exits at the frontier.

**CI gates to enforce (so regressions can't reintroduce fixes):**
- Coverage gate: lines ≥ 90, branches ≥ 85 (vitest --coverage, fail under).
- Mutation gate: Stryker on `packages/core/src/**` weekly, score ≥ 80; block PRs that drop it.
- `pnpm gen:schema` no-diff check (catches the BUG-G class).
- Playwright + axe-core e2e (covers BUG-M/N/O/P regressions live).
- The committed `fuzz.test.ts` on every run + a scheduled deep-fuzz from `qa/corpus/`.
