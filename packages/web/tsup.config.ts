import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "server/index": "server/index.ts" },
  format: ["esm"],
  target: "node22",
  dts: true,
  clean: false,
  outDir: "dist",
});
