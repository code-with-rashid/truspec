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
  // @truspec/core (and its deps zod/yaml) stay external so Node loads them
  // natively — bundling CommonJS libs into ESM breaks `require`. The
  // self-contained single binary is produced later via `bun build --compile`.
  banner: { js: "#!/usr/bin/env node" },
});
