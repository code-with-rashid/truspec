import { defineConfig } from "tsup";

export default defineConfig({
  entry: { extension: "src/extension.ts" },
  format: ["cjs"],
  target: "node18",
  // `vscode` is provided by the host; bundle the engine + its deps into the extension.
  external: ["vscode"],
  noExternal: [/@truspec\/core/, "zod", "zod-to-json-schema", "yaml"],
  clean: true,
  outDir: "dist",
});
