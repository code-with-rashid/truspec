import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { contractReport } from "@truspec/core/spec";
import { formatContract } from "../output";
import { type CommandDeps, emit, num, resolveDeps } from "./deps";

/**
 * `truspec contract --spec <openapi> [<dir>] [--env <name>]` — run the collection and
 * validate each response against its OpenAPI response schema. Exits non-zero on a violation.
 */
export async function contractCommand(argv: string[], deps: Partial<CommandDeps> = {}): Promise<number> {
  const d = resolveDeps(deps);
  const options = {
    spec: { type: "string", short: "s" },
    env: { type: "string", short: "e" },
    timeout: { type: "string" },
    json: { type: "boolean" },
    output: { type: "string", short: "o" },
  } as const;

  let values: { spec?: string; env?: string; timeout?: string; json?: boolean; output?: string };
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
    d.stderr("Usage: truspec contract --spec <openapi> [<dir>] [--env <name>] [--json]\n");
    return 2;
  }

  let report: Awaited<ReturnType<typeof contractReport>>;
  try {
    report = await contractReport(positionals[0] ?? ".", values.spec, {
      env: values.env,
      cwd: d.cwd,
      fetch: d.fetch,
      now: d.now,
      processEnv: d.processEnv,
      timeoutMs: num(values.timeout),
    });
  } catch (e) {
    d.stderr(`Error: ${(e as Error).message}\n`);
    return 1;
  }

  emit(d, values.json ? JSON.stringify(report, null, 2) : formatContract(report), values.output);
  return report.ok ? 0 : 1;
}
