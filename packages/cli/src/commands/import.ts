import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { importBrunoDir, importPostmanFile, writeImport } from "@truspec/core/importers";
import { type CommandDeps, resolveDeps } from "./deps";

/** `truspec import <postman|bruno> <path> [--out <dir>]` — converts to .tspec.yaml files. */
export async function importCommand(argv: string[], deps: Partial<CommandDeps> = {}): Promise<number> {
  const d = resolveDeps(deps);
  const [source, ...rest] = argv;
  if (source !== "postman" && source !== "bruno") {
    d.stderr("Usage: truspec import <postman|bruno> <path> [--out <dir>]\n");
    return 2;
  }

  const options = { out: { type: "string", short: "o" }, "dry-run": { type: "boolean" } } as const;
  let values: { out?: string; "dry-run"?: boolean };
  let positionals: string[];
  try {
    const parsed = parseArgs({ args: rest, allowPositionals: true, options });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (e) {
    d.stderr(`${(e as Error).message}\n`);
    return 2;
  }

  const input = positionals[0];
  if (!input) {
    d.stderr("Missing input path.\nUsage: truspec import <postman|bruno> <path> [--out <dir>]\n");
    return 2;
  }

  let result: ReturnType<typeof importPostmanFile>;
  try {
    result =
      source === "postman"
        ? importPostmanFile(resolve(d.cwd, input))
        : importBrunoDir(resolve(d.cwd, input));
  } catch (e) {
    d.stderr(`Error: ${(e as Error).message}\n`);
    return 1;
  }

  for (const w of result.warnings) d.stderr(`warning: ${w}\n`);

  if (values["dry-run"] || !values.out) {
    d.stdout(
      `${result.stats.requests} request(s), ${result.stats.folders} folder(s) — ${result.files.length} file(s):\n`,
    );
    for (const f of result.files) d.stdout(`  ${f.path}\n`);
    if (!values.out) d.stdout("\n(dry run — pass --out <dir> to write the files)\n");
    return 0;
  }

  const written = writeImport(result, resolve(d.cwd, values.out));
  d.stdout(`Wrote ${written.length} file(s) to ${values.out}\n`);
  return 0;
}
