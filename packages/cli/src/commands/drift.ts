import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { driftReport } from "@truspec/core/spec";
import { formatDrift } from "../output";
import { type CommandDeps, emit, resolveDeps } from "./deps";

/** `truspec drift --spec <openapi> [<dir>]` — exits non-zero when the collection has drifted. */
export async function driftCommand(argv: string[], deps: Partial<CommandDeps> = {}): Promise<number> {
  const d = resolveDeps(deps);
  const options = {
    spec: { type: "string", short: "s" },
    json: { type: "boolean" },
    output: { type: "string", short: "o" },
  } as const;

  let values: { spec?: string; json?: boolean; output?: string };
  let positionals: string[];
  try {
    const parsed = parseArgs({ args: argv, allowPositionals: true, options });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (e) {
    d.stderr(`${(e as Error).message}\n`);
    return 2;
  }

  if (!values.spec) {
    d.stderr("Usage: truspec drift --spec <openapi> [<dir>] [--json]\n");
    return 2;
  }

  let report: ReturnType<typeof driftReport>;
  try {
    report = driftReport(resolve(d.cwd, positionals[0] ?? "."), resolve(d.cwd, values.spec));
  } catch (e) {
    d.stderr(`Error: ${(e as Error).message}\n`);
    return 1;
  }

  emit(d, values.json ? JSON.stringify(report, null, 2) : formatDrift(report), values.output);
  return report.ok ? 0 : 1;
}
