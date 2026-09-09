import { parseArgs } from "node:util";
import { runPath, watchWorkspace, type WorkspaceRunResult } from "@truspec/core/workspace";
import { formatHuman, formatJson, formatJunit } from "../output";
import { formatHtml } from "../report-html";
import { buildFetch, mergeTransport, transportFromEnv } from "../transport";
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
    "no-cookies": { type: "boolean" },
    data: { type: "string", short: "d" },
    repeat: { type: "string" },
    watch: { type: "boolean", short: "w" },
    insecure: { type: "boolean", short: "k" },
    proxy: { type: "string" },
    ca: { type: "string", multiple: true },
    "client-cert": { type: "string" },
    "client-key": { type: "string" },
    "client-key-passphrase": { type: "string" },
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
    "no-cookies"?: boolean;
    data?: string;
    repeat?: string;
    watch?: boolean;
    insecure?: boolean;
    proxy?: string;
    ca?: string[];
    "client-cert"?: string;
    "client-key"?: string;
    "client-key-passphrase"?: string;
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
        "                         [--tag <name>] [--bail] [--delay <ms>] [--no-cookies]\n" +
        "                         [--data <file>] [--repeat <n>]\n" +
        "                         [--json | --reporter <r>]\n" +
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

  // Transport settings come from flags and the environment — never from a request file. See
  // ../transport.ts for why that line is drawn there.
  let transportFetch: typeof globalThis.fetch | undefined;
  try {
    transportFetch = buildFetch(
      mergeTransport(transportFromEnv(d.processEnv), {
        insecure: values.insecure,
        proxy: values.proxy,
        ca: values.ca,
        clientCert: values["client-cert"],
        clientKey: values["client-key"],
        clientKeyPassphrase: values["client-key-passphrase"],
      }),
      d.cwd,
    );
  } catch (e) {
    d.stderr(`Error: could not configure transport: ${(e as Error).message}\n`);
    return 1;
  }
  if (values.insecure) {
    // Loud on purpose: an unverified connection cannot detect a man in the middle, and a run that
    // silently accepted any certificate would be a gate that proves nothing.
    d.stderr("Warning: --insecure disables TLS certificate verification for this run.\n");
  }

  const reporter = values.reporter ?? (values.json ? "json" : "human");
  if (!REPORTERS.includes(reporter as Reporter)) {
    d.stderr(`Unknown --reporter "${reporter}". Known: ${REPORTERS.join(", ")}.\n`);
    return 2;
  }

  /** One pass: run, report, and return the exit code it would produce on its own. */
  const once = async (): Promise<number> => {
    let result: WorkspaceRunResult;
    try {
      result = await runPath(target, {
        env: values.env,
        spec: values.spec,
        cwd: d.cwd,
        // An injected fetch (tests, embedding) always wins over the transport flags.
        fetch: d.fetch ?? transportFetch,
        now: d.now,
        processEnv: d.processEnv,
        timeoutMs: num(values.timeout),
        vars: overrides,
        grep: values.grep,
        tags: values.tag,
        bail: values.bail,
        delayMs: num(values.delay),
        cookies: !values["no-cookies"],
        data: values.data,
        repeat: num(values.repeat),
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

    emit(d, render(reporter as Reporter, result, d.cwd), values.output);
    return result.ok && !noRequests ? 0 : 1;
  };

  const code = await once();
  if (!values.watch) return code;

  // Watch mode never exits on a failing run — a red result is what you are iterating against. It
  // ends only on Ctrl-C, which resolves this promise with the LAST run's code so a wrapped
  // invocation still reports something meaningful.
  d.stdout(`\nWatching for changes — Ctrl-C to stop.\n`);
  return await new Promise<number>((resolveExit) => {
    let last = code;
    const stop = watchWorkspace(target, async () => {
      d.stdout(`\n${"─".repeat(40)}\nchange detected — re-running\n`);
      last = await once();
    }, {
      cwd: d.cwd,
      onError: (e) => d.stderr(`Error: ${e instanceof Error ? e.message : String(e)}\n`),
    });
    const finish = (): void => {
      stop();
      process.off("SIGINT", finish);
      d.stdout("\n");
      resolveExit(last);
    };
    process.on("SIGINT", finish);
  });
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
