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
      reporter: ["text-summary"],
      // CI gate: `pnpm test:coverage` fails if coverage regresses below these. Current: lines 95.18%,
      // branches 86.52%, functions 98.27% (see qa/COVERAGE.json).
      thresholds: { lines: 90, branches: 85, functions: 90, statements: 90 },
    },
  },
});
