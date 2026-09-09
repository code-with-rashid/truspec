import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { initNextSteps, type InitResult, initProject } from "@truspec/core/workspace";
import { type CommandDeps, resolveDeps } from "./deps";
import { argError } from "../args";

const USAGE =
  "Usage: truspec init [<dir>] [--spec <openapi>] [--dir <requests>] [--base-url <url>] [--env <name>] [--force]\n";

/** `truspec init [dir]` — scaffold a runnable collection: a request, an environment, a .gitignore. */
export async function initCommand(argv: string[], deps: Partial<CommandDeps> = {}): Promise<number> {
  const d = resolveDeps(deps);
  const options = {
    spec: { type: "string", short: "s" },
    dir: { type: "string" },
    "base-url": { type: "string" },
    env: { type: "string", short: "e" },
    force: { type: "boolean" },
  } as const;

  let values: { spec?: string; dir?: string; "base-url"?: string; env?: string; force?: boolean };
  let positionals: string[];
  try {
    const parsed = parseArgs({ args: argv, allowPositionals: true, options });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (e) {
    d.stderr(argError(e, "init", options, USAGE));
    return 2;
  }

  const requestsDir = values.dir ?? "api";
  const envName = values.env ?? "local";
  const root = resolve(d.cwd, positionals[0] ?? ".");

  let specText: string | undefined;
  if (values.spec) {
    const specPath = resolve(d.cwd, values.spec);
    if (!existsSync(specPath)) {
      d.stderr(`Spec not found: ${values.spec}\n`);
      return 1;
    }
    specText = readFileSync(specPath, "utf8");
  }

  let result: InitResult;
  try {
    result = initProject(root, {
      requestsDir,
      env: envName,
      ...(specText !== undefined ? { specText } : {}),
      ...(values["base-url"] ? { baseUrl: values["base-url"] } : {}),
      ...(values.force ? { force: true } : {}),
    });
  } catch (e) {
    d.stderr(`Error: ${(e as Error).message}\n`);
    return 1;
  }

  for (const f of result.created) d.stdout(`  created  ${f}\n`);
  // Saying what was left alone matters more than saying what was written: it is the difference
  // between "init did nothing" and "init respected the files you already had".
  for (const f of result.skipped) d.stdout(`  exists   ${f}  (left alone; --force to overwrite)\n`);

  if (result.created.length === 0) {
    d.stdout("\nNothing to do — this directory is already set up.\n");
    return 0;
  }
  d.stdout("\nNext:\n");
  const steps = initNextSteps(result, {
    requestsDir,
    envName,
    cwd: d.cwd,
    ...(values.spec ? { specPath: values.spec } : {}),
    ...(values["base-url"] ? { baseUrl: values["base-url"] } : {}),
  });
  for (const step of steps) d.stdout(`  ${step}\n`);
  return 0;
}
