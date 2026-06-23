import { parseArgs } from "node:util";
import { runPath, type WorkspaceRunResult } from "@truspec/core/workspace";
import { formatHuman, formatJson, formatJunit } from "../output";
import { type CommandDeps, emit, num, resolveDeps } from "./deps";

/** `truspec run <path>` — returns a process exit code (0 ok, 1 failures/error, 2 usage). */
export async function runCommand(argv: string[], deps: Partial<CommandDeps> = {}): Promise<number> {
  const d = resolveDeps(deps);

  const options = {
    env: { type: "string", short: "e" },
    spec: { type: "string", short: "s" },
    json: { type: "boolean" },
    reporter: { type: "string" },
    output: { type: "string", short: "o" },
    timeout: { type: "string" },
  } as const;

  let values: {
    env?: string;
    spec?: string;
    json?: boolean;
    reporter?: string;
    output?: string;
    timeout?: string;
  };
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
    d.stderr(
      "Usage: truspec run <path> [--env <name>] [--spec <openapi>] [--json] [--output <file>] [--timeout <ms>]\n",
    );
    return 2;
  }

  let result: WorkspaceRunResult;
  try {
    result = await runPath(target, {
      env: values.env,
      spec: values.spec,
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

  if (result.missingSecrets.length > 0) {
    d.stderr(`Warning: unresolved secrets (set as env vars): ${result.missingSecrets.join(", ")}\n`);
  }
  // Finding ZERO requests is a failure, not a pass: `run` is a CI gate, and a green build when no
  // request executed silently masks a misconfigured path, uncommitted files, or a bad glob — the
  // worst kind of false-positive for a gate. (`[].every()` is `true`, so `result.ok` alone says
  // "pass" here.) Industry test runners (jest, pytest, go test) fail on "no tests found" too.
  const noRequests = result.results.length === 0;
  if (noRequests) {
    d.stderr(`Error: no .tspec.yaml requests found under "${target}".\n`);
  }

  const reporter = values.reporter ?? (values.json ? "json" : "human");
  const text =
    reporter === "junit"
      ? formatJunit(result, d.cwd)
      : reporter === "json"
        ? formatJson(result)
        : formatHuman(result, d.cwd);
  emit(d, text, values.output);
  return result.ok && !noRequests ? 0 : 1;
}
