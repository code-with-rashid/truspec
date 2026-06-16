import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node22",
  clean: true,
  // @truspec/core (and its deps zod/yaml) stay external so Node loads them
  // natively — bundling CommonJS libs into ESM breaks `require`. The
  // self-contained single binary is produced later via `bun build --compile`.
  banner: { js: "#!/usr/bin/env node" },
});
