import { createHmac, randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { createContext, runInContext } from "node:vm";
import type { AssertionResult, ResponseView } from "./assertions";
import type { VarValue, Vars } from "./interpolate";

/** One line a script printed, and which method printed it. */
export interface ScriptLog {
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
}

export interface ScriptResult {
  captured: Record<string, VarValue>;
  assertions: AssertionResult[];
  logs: ScriptLog[];
  error?: string;
}

export interface PreScriptResult {
  /** Variables the script set via `tr.set`, merged into the run before the request resolves. */
  vars: Record<string, VarValue>;
  logs: ScriptLog[];
  error?: string;
}

/**
 * How many lines one script may print before the rest are dropped, and how long each may be.
 *
 * A script that logs inside a loop should not be able to turn a run report into a memory problem
 * or an unreadable wall — but silently keeping the *first* N with no notice would misreport what
 * happened, so the cap announces itself as a final line.
 */
const MAX_LOGS = 100;
const MAX_LOG_CHARS = 2_000;

/**
 * A `console` for the vm context that collects what a script prints.
 *
 * Node injects a `console` into every new vm context, so `console.log` in a script has always been
 * *defined* — and has always written nowhere at all. Not an error the author could see, not a line
 * anywhere: the single most common thing anyone does to debug a script was a silent no-op.
 *
 * Collected rather than written to a stream, which is the only option that works everywhere this
 * engine runs: the MCP server speaks JSON-RPC over stdout, where one stray line corrupts the
 * protocol, and the browser client has no stdout at all. The lines travel in the result, and each
 * surface renders them.
 */
function collectingConsole(logs: ScriptLog[]): Record<string, (...args: unknown[]) => void> {
  const write = (level: ScriptLog["level"]) => (...args: unknown[]): void => {
    if (logs.length > MAX_LOGS) return;
    if (logs.length === MAX_LOGS) {
      logs.push({ level: "warn", message: `… further output suppressed after ${MAX_LOGS} lines.` });
      return;
    }
    // `inspect` is what Node's own console uses, so an object logs the way an author expects
    // rather than as "[object Object]".
    const message = args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 4 }))).join(" ");
    logs.push({ level, message: message.length > MAX_LOG_CHARS ? `${message.slice(0, MAX_LOG_CHARS)}…` : message });
  };
  return { log: write("log"), info: write("info"), warn: write("warn"), error: write("error"), debug: write("debug") };
}

/** Coerce a script value into a variable (objects/arrays become JSON so interpolation stays string-safe). */
function toVarValue(value: unknown): VarValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : JSON.stringify(value);
}

/**
 * Run a pre-request script in a Node vm context, **before** the request is resolved, so it can
 * compute values the URL/headers/body then interpolate. Curated `tr` API (no response yet):
 *   tr.vars                          snapshot of current variables (read)
 *   tr.set(name, value)              set a variable used by this request
 *   tr.uuid()                        a random UUID v4
 *   tr.base64(s)                     base64-encode a string
 *   tr.hmac(algo, key, data, enc?)   HMAC digest — enc "hex" (default) | "base64" (request signing)
 *   tr.env(name)                     read an OS environment variable
 *
 * NOTE: a vm context is NOT a security sandbox (see runPostScript). Trusted input only.
 */
export function runPreScript(source: string, vars: Vars): PreScriptResult {
  const out: Record<string, VarValue> = {};
  const tr = {
    vars: { ...vars },
    set(name: string, value: unknown): void {
      out[name] = toVarValue(value);
    },
    uuid: (): string => randomUUID(),
    base64: (s: unknown): string => Buffer.from(String(s), "utf8").toString("base64"),
    hmac: (algo: string, key: string, data: string, enc: "hex" | "base64" = "hex"): string =>
      createHmac(String(algo), String(key)).update(String(data)).digest(enc),
    env: (name: string): string | undefined => process.env[name],
  };

  const logs: ScriptLog[] = [];
  try {
    runInContext(source, createContext({ tr, console: collectingConsole(logs) }), { timeout: 1000 });
  } catch (e) {
    return { vars: out, logs, error: (e as Error).message };
  }
  return { vars: out, logs };
}

/**
 * Run a post-response script in a Node vm context with a curated `tr` API:
 *   tr.response          { status, headers, bodyText, json }
 *   tr.vars              snapshot of current variables
 *   tr.set(name, value)  set a variable for later requests
 *   tr.expect(cond, msg) record a pass/fail assertion
 *
 * NOTE: a vm context is NOT a security sandbox — scripts are authored in the
 * user's own collection (same trust model as Postman/Bruno scripts). Only run
 * collections you trust.
 */
export function runPostScript(source: string, res: ResponseView, vars: Vars): ScriptResult {
  const captured: Record<string, VarValue> = {};
  const assertions: AssertionResult[] = [];

  const tr = {
    response: { status: res.status, headers: res.headers, bodyText: res.bodyText, json: res.json },
    vars: { ...vars },
    set(name: string, value: unknown): void {
      captured[name] = toVarValue(value);
    },
    expect(condition: unknown, message?: string): void {
      assertions.push({ type: "script", ok: Boolean(condition), message: message ?? "expectation" });
    },
  };

  const logs: ScriptLog[] = [];
  try {
    runInContext(source, createContext({ tr, console: collectingConsole(logs) }), { timeout: 1000 });
  } catch (e) {
    return { captured, assertions, logs, error: (e as Error).message };
  }
  return { captured, assertions, logs };
}
