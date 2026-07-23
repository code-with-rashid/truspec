import { defineConfig } from "tsup";

/**
 * Unlike `tsup.config.ts` (the published-library build, which correctly leaves `@truspec/core`
 * external so a real npm install resolves it), this bundle ships standalone — as a Tauri sidecar,
 * with no accompanying `node_modules` — so every dependency must be inlined.
 */
export default defineConfig({
  entry: { "sidecar/cli-entry": "server/cli-entry-run.ts" },
  format: ["cjs"],
  target: "node22",
  platform: "node",
  noExternal: ["@truspec/core", "zod", "yaml", "zod-to-json-schema"],
  dts: false,
  clean: false,
  outDir: "dist",
});
