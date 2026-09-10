import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildFetch, mergeTransport, transportFromEnv } from "../transport";
import { type CommandDeps, num, resolveDeps } from "./deps";
import { argError, mainArg } from "../args";

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

const USAGE = "Usage: truspec serve [<dir>] [--port <n>]\n";

/** `truspec serve [<dir>] [--port <n>]` — local web UI over the engine. */
export async function serveCommand(argv: string[], deps: ServeDeps = {}): Promise<number> {
  const d = resolveDeps(deps);
  // The same transport flags `run` takes. Without them the UI could not reach a host the CLI
  // could — a self-signed staging box, anything behind a corporate proxy — and the collection
  // would pass in CI and fail in the browser with nothing on screen to explain the difference.
  const options = {
    dir: { type: "string", short: "d" },
    port: { type: "string", short: "p" },
    insecure: { type: "boolean", short: "k" },
    proxy: { type: "string" },
    "no-proxy": { type: "string" },
    ca: { type: "string", multiple: true },
    "client-cert": { type: "string" },
    "client-key": { type: "string" },
    "client-key-passphrase": { type: "string" },
  } as const;

  let values: {
    dir?: string;
    port?: string;
    insecure?: boolean;
    proxy?: string;
    "no-proxy"?: string;
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
    d.stderr(argError(e, "serve", options));
    return 2;
  }

  // `run`, `lint`, `docs`, `drift`, `coverage`, `contract` and `init` all take the collection as a
  // positional, so `truspec serve examples` is what anyone types. It used to be *accepted and
  // discarded*: the server came up on the current directory instead, said so in one line nobody
  // reads twice, and the wrong collection was on screen.
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
  // A directory that is not there produced a server on it anyway, and the UI's empty state said
  // "no requests yet" — which reads as a fact about the collection rather than as the typo it is.
  // `lint` and `run` both refuse first; so does this now.
  const abs = resolve(d.cwd, dir);
  if (!existsSync(abs)) {
    d.stderr(`Path not found: ${dir}\n${USAGE}`);
    return 1;
  }
  if (!statSync(abs).isDirectory()) {
    d.stderr(`Not a directory: ${dir}\n${USAGE}`);
    return 1;
  }

  let transportFetch: typeof globalThis.fetch | undefined;
  try {
    transportFetch = buildFetch(
      mergeTransport(transportFromEnv(d.processEnv), {
        insecure: values.insecure,
        proxy: values.proxy,
        noProxy: values["no-proxy"],
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
    // Same warning `run` prints, and for longer: this one holds for every request the UI sends
    // until the server is stopped.
    d.stderr("Warning: --insecure disables TLS certificate verification for every request this server sends.\n");
  }

  // Lazily load the web package so the CLI works even when the UI isn't built.
  const pkg = "@truspec/web";
  const mod = (await import(pkg).catch(() => null)) as {
    startWebServer: (o: {
      dir?: string;
      port?: number;
      fetch?: typeof globalThis.fetch;
    }) => Promise<WebServerHandle>;
  } | null;
  if (!mod) {
    d.stderr("Web UI not available — build it with `pnpm --filter @truspec/web build`.\n");
    return 1;
  }

  let handle: WebServerHandle;
  try {
    handle = await mod.startWebServer({
      dir: abs,
      port: num(values.port) ?? 4100,
      ...(transportFetch ? { fetch: transportFetch } : {}),
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
