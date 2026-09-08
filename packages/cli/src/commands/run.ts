import { parseArgs } from "node:util";
import { runPath, type WorkspaceRunResult } from "@truspec/core/workspace";
import { formatHuman, formatJson, formatJunit } from "../output";
import { formatHtml } from "../report-html";
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
    var: { type: "string", multiple: true },
    grep: { type: "string", short: "g" },
    tag: { type: "string", multiple: true },
    bail: { type: "boolean" },
    delay: { type: "string" },
  } as const;

  let values: {
    env?: string;
    spec?: string;
    json?: boolean;
    reporter?: string;
    output?: string;
    timeout?: string;
    var?: string[];
    grep?: string;
    tag?: string[];
    bail?: boolean;
    delay?: string;
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
      "Usage: truspec run <path> [--env <name>] [--spec <openapi>] [--var k=v] [--grep <re>]\n" +
        "                         [--tag <name>] [--bail] [--delay <ms>] [--json | --reporter <r>]\n" +
        "                         [--output <file>] [--timeout <ms>]\n",
    );
    return 2;
  }

  let overrides: Record<string, string>;
  try {
    overrides = parseVarFlags(values.var ?? []);
  } catch (e) {
    d.stderr(`${(e as Error).message}\n`);
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
      vars: overrides,
      grep: values.grep,
      tags: values.tag,
      bail: values.bail,
      delayMs: num(values.delay),
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
    // Distinguish "nothing here" from "your filter matched nothing" — the fix differs, and a
    // silently-empty filtered run is exactly the false-positive this gate exists to prevent.
    d.stderr(
      result.deselected
        ? `Error: --grep/--tag matched none of the ${result.deselected} request(s) under "${target}".\n`
        : `Error: no .tspec.yaml requests found under "${target}".\n`,
    );
  }

  const reporter = values.reporter ?? (values.json ? "json" : "human");
  if (!REPORTERS.includes(reporter as Reporter)) {
    d.stderr(`Unknown --reporter "${reporter}". Known: ${REPORTERS.join(", ")}.\n`);
    return 2;
  }
  const text = render(reporter as Reporter, result, d.cwd);
  emit(d, text, values.output);
  return result.ok && !noRequests ? 0 : 1;
}

const REPORTERS = ["human", "json", "junit", "html"] as const;
type Reporter = (typeof REPORTERS)[number];

function render(reporter: Reporter, result: WorkspaceRunResult, cwd: string): string {
  switch (reporter) {
    case "junit":
      return formatJunit(result, cwd);
    case "json":
      return formatJson(result);
    case "html":
      return formatHtml(result, cwd);
    default:
      return formatHuman(result, cwd);
  }
}

/**
 * Parse repeated `--var name=value` flags into a variable map. These win over the environment,
 * so CI can inject a per-branch base URL or a one-off id without editing a file.
 */
function parseVarFlags(flags: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of flags) {
    const eq = raw.indexOf("=");
    if (eq <= 0) throw new Error(`Invalid --var "${raw}" — expected name=value`);
    out[raw.slice(0, eq)] = raw.slice(eq + 1);
  }
  return out;
}
