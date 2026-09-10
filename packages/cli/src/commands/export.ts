import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type ExportResult, exportPostman } from "@truspec/core/exporters";
import { type CommandDeps, emit, resolveDeps } from "./deps";
import { argError, mainArg } from "../args";

const TARGETS = ["postman"] as const;
type Target = (typeof TARGETS)[number];

const USAGE = `Usage: truspec export <${TARGETS.join("|")}> [<dir>] [--name <text>] [--output <file>]\n`;

/**
 * `truspec export postman [<dir>]` — a collection back out as a Postman v2.1 file.
 *
 * The converter has existed in `@truspec/core/exporters` and behind the web UI's export button for
 * a long time; the CLI had no way to reach it, so the "you are not locked in" claim was only true
 * for people already running the UI. Handing a collection to someone who works in Postman is a
 * scripting job — a release step, a CI artifact — which is exactly where a CLI belongs.
 */
export async function exportCommand(argv: string[], deps: Partial<CommandDeps> = {}): Promise<number> {
  const d = resolveDeps(deps);
  const [target, ...rest] = argv;
  if (!TARGETS.includes(target as Target)) {
    // Naming the one target beats a bare usage line while there is only one: the reader learns
    // what is available in the same breath as what went wrong.
    d.stderr(
      target ? `Unknown export target "${target}". Known: ${TARGETS.join(", ")}.\n${USAGE}` : USAGE,
    );
    return 2;
  }

  const options = {
    name: { type: "string" },
    output: { type: "string", short: "o" },
    dir: { type: "string", short: "d" },
  } as const;
  let values: { name?: string; output?: string; dir?: string };
  let positionals: string[];
  try {
    const parsed = parseArgs({ args: rest, allowPositionals: true, options });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (e) {
    d.stderr(argError(e, "export", options, USAGE));
    return 2;
  }

  const collection = mainArg(positionals, values.dir, {
    what: "collection directory",
    flag: "--dir",
    usage: USAGE,
  });
  if (collection.error) {
    d.stderr(collection.error);
    return 2;
  }
  const dir = collection.value ?? ".";
  const abs = resolve(d.cwd, dir);
  if (!existsSync(abs)) {
    d.stderr(`Path not found: ${dir}\n${USAGE}`);
    return 1;
  }
  if (!statSync(abs).isDirectory()) {
    d.stderr(`Not a directory: ${dir}\n${USAGE}`);
    return 1;
  }

  let result: ExportResult;
  try {
    result = exportPostman(abs, values.name);
  } catch (e) {
    d.stderr(`Error: ${(e as Error).message}\n`);
    return 1;
  }

  // Warnings on stderr, so `truspec export postman ./api > collection.json` writes clean JSON.
  for (const w of result.warnings) d.stderr(`warning: ${w}\n`);
  if (result.stats.requests === 0) {
    d.stderr(`No requests found under ${dir}.\n`);
    return 1;
  }

  emit(d, JSON.stringify(result.collection, null, 2), values.output);
  if (values.output) {
    d.stderr(`${result.stats.requests} request(s), ${result.stats.folders} folder(s).\n`);
  }
  return 0;
}
