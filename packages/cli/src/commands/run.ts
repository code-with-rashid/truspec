import { parseArgs } from "node:util";
import { runPath, type WorkspaceRunResult } from "@truspec/core/workspace";
import { formatHuman, formatJson } from "../output";
import { type CommandDeps, emit, resolveDeps } from "./deps";

/** `truspec run <path>` — returns a process exit code (0 ok, 1 failures/error, 2 usage). */
export async function runCommand(argv: string[], deps: Partial<CommandDeps> = {}): Promise<number> {
  const d = resolveDeps(deps);

  const options = {
    env: { type: "string", short: "e" },
    json: { type: "boolean" },
    output: { type: "string", short: "o" },
    timeout: { type: "string" },
  } as const;

  let values: { env?: string; json?: boolean; output?: string; timeout?: string };
  let positionals: string[];
  try {
    const parsed = parseArgs({ args: argv, allowPositionals: true, options });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (e) {
    d.stderr(`${(e as Error).message}\n`);
    return 2;
  }

  const target = positionals[0];
  if (!target) {
    d.stderr("Usage: truspec run <path> [--env <name>] [--json] [--output <file>] [--timeout <ms>]\n");
    return 2;
  }

  let result: WorkspaceRunResult;
  try {
    result = await runPath(target, {
      env: values.env,
      cwd: d.cwd,
      fetch: d.fetch,
      now: d.now,
      processEnv: d.processEnv,
      timeoutMs: values.timeout ? Number(values.timeout) : undefined,
    });
  } catch (e) {
    d.stderr(`Error: ${(e as Error).message}\n`);
    return 1;
  }

  if (result.missingSecrets.length > 0) {
    d.stderr(`Warning: unresolved secrets (set as env vars): ${result.missingSecrets.join(", ")}\n`);
  }

  emit(d, values.json ? formatJson(result) : formatHuman(result, d.cwd), values.output);
  return result.ok ? 0 : 1;
}
