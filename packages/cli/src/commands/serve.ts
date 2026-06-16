import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type CommandDeps, resolveDeps } from "./deps";

interface WebServerHandle {
  url: string;
  dir: string;
  port: number;
  close: () => Promise<void>;
}

export interface ServeDeps extends Partial<CommandDeps> {
  onReady?: (handle: WebServerHandle) => void;
  block?: boolean;
}

/** `truspec serve [--dir <collection>] [--port <n>]` — local web UI over the engine. */
export async function serveCommand(argv: string[], deps: ServeDeps = {}): Promise<number> {
  const d = resolveDeps(deps);
  const options = { dir: { type: "string", short: "d" }, port: { type: "string", short: "p" } } as const;

  let values: { dir?: string; port?: string };
  try {
    values = parseArgs({ args: argv, allowPositionals: true, options }).values;
  } catch (e) {
    d.stderr(`${(e as Error).message}\n`);
    return 2;
  }

  // Lazily load the web package so the CLI works even when the UI isn't built.
  const pkg = "@truspec/web";
  const mod = (await import(pkg).catch(() => null)) as {
    startWebServer: (o: { dir?: string; port?: number }) => Promise<WebServerHandle>;
  } | null;
  if (!mod) {
    d.stderr("Web UI not available — build it with `pnpm --filter @truspec/web build`.\n");
    return 1;
  }

  let handle: WebServerHandle;
  try {
    handle = await mod.startWebServer({
      dir: resolve(d.cwd, values.dir ?? "."),
      port: values.port ? Number(values.port) : 4100,
    });
  } catch (e) {
    d.stderr(`Error: ${(e as Error).message}\n`);
    return 1;
  }

  d.stdout(`TruSpec web UI on ${handle.url}  (serving ${handle.dir})\nPress Ctrl+C to stop.\n`);
  deps.onReady?.(handle);
  if (deps.block === false) return 0;
  await new Promise<never>(() => {});
  return 0;
}
