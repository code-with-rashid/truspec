import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { scaffoldFromSpec, writeScaffold } from "@truspec/core/spec";
import { type CommandDeps, resolveDeps } from "./deps";

/** `truspec gen --spec <openapi> --out <dir>` — scaffold a request stub per operation. */
export async function genCommand(argv: string[], deps: Partial<CommandDeps> = {}): Promise<number> {
  const d = resolveDeps(deps);
  const options = {
    spec: { type: "string", short: "s" },
    out: { type: "string", short: "o" },
    "base-url-var": { type: "string" },
  } as const;

  let values: { spec?: string; out?: string; "base-url-var"?: string };
  try {
    values = parseArgs({ args: argv, allowPositionals: true, options }).values;
  } catch (e) {
    d.stderr(`${(e as Error).message}\n`);
    return 2;
  }
  if (!values.spec || !values.out) {
    d.stderr("Usage: truspec gen --spec <openapi> --out <dir> [--base-url-var <name>]\n");
    return 2;
  }

  const specPath = resolve(d.cwd, values.spec);
  if (!existsSync(specPath)) {
    d.stderr(`Spec not found: ${values.spec}\n`);
    return 1;
  }
  let result: ReturnType<typeof scaffoldFromSpec>;
  try {
    const specText = readFileSync(specPath, "utf8");
    result = scaffoldFromSpec(specText, { baseUrlVar: values["base-url-var"] });
  } catch (e) {
    d.stderr(`Error: ${(e as Error).message}\n`);
    return 1;
  }

  const written = writeScaffold(result.files, resolve(d.cwd, values.out));
  d.stdout(`Generated ${written.length} request(s) in ${values.out}\n`);
  for (const op of result.skipped) d.stderr(`skipped (unsupported method): ${op}\n`);
  return 0;
}
