import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { coverageReport } from "@truspec/core/spec";
import { formatCoverage } from "../output";
import { type CommandDeps, emit, num, resolveDeps } from "./deps";

/** `truspec coverage --spec <openapi> [<dir>] [--min <percent>]` — gates when below `--min`. */
export async function coverageCommand(argv: string[], deps: Partial<CommandDeps> = {}): Promise<number> {
  const d = resolveDeps(deps);
  const options = {
    spec: { type: "string", short: "s" },
    min: { type: "string" },
    json: { type: "boolean" },
    output: { type: "string", short: "o" },
  } as const;

  let values: { spec?: string; min?: string; json?: boolean; output?: string };
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
    d.stderr("Usage: truspec coverage --spec <openapi> [<dir>] [--min <percent>] [--json]\n");
    return 2;
  }

  const min = num(values.min) ?? 0;
  let report: ReturnType<typeof coverageReport>;
  try {
    report = coverageReport(resolve(d.cwd, positionals[0] ?? "."), resolve(d.cwd, values.spec), min);
  } catch (e) {
    d.stderr(`Error: ${(e as Error).message}\n`);
    return 1;
  }

  emit(d, values.json ? JSON.stringify(report, null, 2) : formatCoverage(report), values.output);
  return report.ok ? 0 : 1;
}
