// Emits the published JSON Schema artifacts from the Zod source of truth.
// Run after build:  pnpm --filter @truspec/core build && node scripts/emit-schema.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

let buildJsonSchemas;
try {
  ({ buildJsonSchemas } = await import("../dist/format/index.js"));
} catch {
  console.error("dist not found — run `pnpm --filter @truspec/core build` first.");
  process.exit(1);
}

const outDir = join(here, "..", "schema");
mkdirSync(outDir, { recursive: true });

for (const [file, schema] of Object.entries(buildJsonSchemas())) {
  writeFileSync(join(outDir, file), `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`wrote schema/${file}`);
}
