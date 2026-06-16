import { createHmac, randomUUID } from "node:crypto";
import { createContext, runInContext } from "node:vm";
import type { AssertionResult, ResponseView } from "./assertions";
import type { VarValue, Vars } from "./interpolate";

export interface ScriptResult {
  captured: Record<string, VarValue>;
  assertions: AssertionResult[];
  error?: string;
}

export interface PreScriptResult {
  /** Variables the script set via `tr.set`, merged into the run before the request resolves. */
  vars: Record<string, VarValue>;
  error?: string;
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

  try {
    runInContext(source, createContext({ tr }), { timeout: 1000 });
  } catch (e) {
    return { vars: out, error: (e as Error).message };
  }
  return { vars: out };
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

  try {
    runInContext(source, createContext({ tr }), { timeout: 1000 });
  } catch (e) {
    return { captured, assertions, error: (e as Error).message };
  }
  return { captured, assertions };
}
