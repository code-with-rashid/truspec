import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node22",
  clean: true,
  define: { __TRUSPEC_VERSION__: JSON.stringify(version) },
  banner: { js: "#!/usr/bin/env node" },
});
