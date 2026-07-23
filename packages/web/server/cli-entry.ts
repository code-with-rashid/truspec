import { parseArgs } from "node:util";
import { startWebServer, type WebServerHandle } from "./index";

export interface SidecarDeps {
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  exit?: (code: number) => void;
}

/**
 * Machine-readable entry point for embedding `startWebServer` outside the CLI (e.g. as a Tauri
 * sidecar): parses a handful of flags, starts the server, then prints a single JSON line —
 * `{"url":...,"port":...}` — once it's actually listening, for a parent process to read off
 * stdout. Unlike `truspec serve`, `--client-dir` is required rather than defaulted from
 * `import.meta.url`: once this file is bundled standalone (see `tsup.sidecar.config.ts`) and
 * shipped alongside a differently-laid-out resource bundle, a path relative to *this* file's
 * on-disk location is meaningless.
 */
/**
 * Returns the started server's handle (so tests/embedders can `.close()` it) — the real
 * standalone invocation (`cli-entry-run.ts`) never calls `.close()` and just lets the process
 * stay alive, which is what makes it work as a long-lived sidecar.
 */
export async function runSidecar(argv: string[], deps: SidecarDeps = {}): Promise<WebServerHandle | undefined> {
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s));
  const exit = deps.exit ?? ((code: number) => process.exit(code));

  const options = { dir: { type: "string" }, "client-dir": { type: "string" }, port: { type: "string" } } as const;
  let values: { dir?: string; "client-dir"?: string; port?: string };
  try {
    values = parseArgs({ args: argv, options }).values;
  } catch (e) {
    stderr(`${(e as Error).message}\n`);
    exit(2);
    return undefined;
  }

  if (!values.dir || !values["client-dir"]) {
    stderr("Usage: cli-entry --dir <collection> --client-dir <built client assets> [--port <n>]\n");
    exit(2);
    return undefined;
  }

  const port = values.port !== undefined ? Number(values.port) : 0;
  if (!Number.isFinite(port)) {
    stderr(`Invalid --port: ${values.port}\n`);
    exit(2);
    return undefined;
  }

  try {
    const handle = await startWebServer({ dir: values.dir, clientDir: values["client-dir"], port });
    stdout(`${JSON.stringify({ url: handle.url, port: handle.port })}\n`);
    return handle;
  } catch (e) {
    stderr(`${e instanceof Error ? e.message : String(e)}\n`);
    exit(1);
    return undefined;
  }
}
