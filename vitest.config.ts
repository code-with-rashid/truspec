import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const core = (p: string): string =>
  fileURLToPath(new URL(`packages/core/src/${p}`, import.meta.url));

export default defineConfig({
  // Resolve @truspec/core to source so tests run without a build step.
  resolve: {
    alias: [
      { find: "@truspec/core/workspace", replacement: core("workspace/index.ts") },
      { find: "@truspec/core/spec", replacement: core("spec/index.ts") },
      { find: "@truspec/core/importers", replacement: core("importers/index.ts") },
      { find: "@truspec/core/exporters", replacement: core("exporters/index.ts") },
      { find: "@truspec/core/codegen", replacement: core("codegen/index.ts") },
      { find: "@truspec/core/lint", replacement: core("lint/index.ts") },
      { find: "@truspec/core/jsonpath", replacement: core("jsonpath/index.ts") },
      { find: "@truspec/core/docs", replacement: core("docs/index.ts") },
      { find: "@truspec/core/mock", replacement: core("mock/index.ts") },
      { find: "@truspec/core/runner", replacement: core("runner/index.ts") },
      { find: "@truspec/core/format", replacement: core("format/index.ts") },
      { find: "@truspec/core", replacement: core("index.ts") },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      // index.ts = re-export barrels; format/types.ts = pure `z.infer` type aliases (no runtime code,
      // validated by typecheck). Neither has anything executable to cover.
      exclude: ["**/index.ts", "packages/core/src/format/types.ts"],
      reporter: ["text-summary", "json-summary"],
      // CI gate: `pnpm test:coverage` fails if coverage regresses below these.
      //
      // Raised from 90/85/90/90. Those were far enough below the real numbers that ~3,000 lines of
      // new code could land and drag functions from 98% to 89.9% before anything complained — the
      // gate only caught it after the fact. Set just under the current figures (lines 95.43%,
      // branches 87.78%, functions 97.01%) so a real regression trips on the commit that causes it.
      thresholds: { lines: 95, branches: 87, functions: 96, statements: 95 },
    },
  },
});
