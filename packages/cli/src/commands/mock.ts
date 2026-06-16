import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type MockServerHandle, startMockServer } from "@truspec/core/mock";
import { type CommandDeps, num, resolveDeps } from "./deps";

export interface MockDeps extends Partial<CommandDeps> {
  /** Called once the server is listening (used by tests to grab the handle). */
  onReady?: (handle: MockServerHandle) => void;
  /** When false, return after starting instead of blocking until Ctrl+C. */
  block?: boolean;
}

/** `truspec mock --spec <openapi> [--port <n>]` — serve generated responses from a spec. */
export async function mockCommand(argv: string[], deps: MockDeps = {}): Promise<number> {
  const d = resolveDeps(deps);
  const options = {
    spec: { type: "string", short: "s" },
    port: { type: "string", short: "p" },
    delay: { type: "string" },
    validate: { type: "boolean" },
  } as const;

  let values: { spec?: string; port?: string; delay?: string; validate?: boolean };
  try {
    values = parseArgs({ args: argv, allowPositionals: true, options }).values;
  } catch (e) {
    d.stderr(`${(e as Error).message}\n`);
    return 2;
  }
  if (!values.spec) {
    d.stderr("Usage: truspec mock --spec <openapi> [--port <n>]\n");
    return 2;
  }

  const specPath = resolve(d.cwd, values.spec);
  if (!existsSync(specPath)) {
    d.stderr(`Spec not found: ${values.spec}\n`);
    return 1;
  }
  let handle: MockServerHandle;
  try {
    const specText = readFileSync(specPath, "utf8");
    handle = await startMockServer(specText, {
      port: num(values.port) ?? 4000,
      delayMs: num(values.delay),
      validate: values.validate,
    });
  } catch (e) {
    d.stderr(`Error: ${(e as Error).message}\n`);
    return 1;
  }

  d.stdout(`Mock server on ${handle.url} — ${handle.routes} route(s). Press Ctrl+C to stop.\n`);
  deps.onReady?.(handle);
  if (deps.block === false) return 0;
  await new Promise<never>(() => {}); // keep the process alive until interrupted
  return 0;
}
