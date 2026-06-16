import { createContext, runInContext } from "node:vm";
import type { AssertionResult, ResponseView } from "./assertions";
import type { VarValue, Vars } from "./interpolate";

export interface ScriptResult {
  captured: Record<string, VarValue>;
  assertions: AssertionResult[];
  error?: string;
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
      captured[name] =
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? value
          : JSON.stringify(value);
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
