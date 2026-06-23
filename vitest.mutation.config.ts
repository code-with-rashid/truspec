import { mergeConfig } from "vitest/config";
import base from "./vitest.config";

// Config used ONLY by Stryker (stryker.config.json -> vitest.configFile). Mutation testing re-runs the
// covering tests for every mutant, so a slow smoke test in the covering set multiplies the whole run.
// fuzz.test.ts (~11s, property fuzz) covers many engine/runner/spec mutants and made Stryker crawl;
// exclude it here — the deterministic UNIT tests are what should kill mutants. The bounded fuzz still
// runs in the normal `pnpm test` and per-PR CI.
export default mergeConfig(base, {
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/fuzz.test.ts"],
  },
});
