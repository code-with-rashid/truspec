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
      { find: "@truspec/core/runner", replacement: core("runner/index.ts") },
      { find: "@truspec/core/format", replacement: core("format/index.ts") },
      { find: "@truspec/core", replacement: core("index.ts") },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/*/src/**/*.test.ts"],
  },
});
