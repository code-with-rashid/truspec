import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/format/index.ts", "src/runner/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
});
