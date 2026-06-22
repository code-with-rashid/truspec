import type { TruSpecAssertion } from "../format/types";
import { responseSchemaFor, type SpecOperation } from "../spec/openapi";
import { validateAgainstSchema } from "../spec/validate-response";
import { jsonpath } from "./jsonpath";

/** Everything except the spec-aware `schema` assertion, which needs the OpenAPI document. */
type ResponseAssertion = Exclude<TruSpecAssertion, { type: "schema" }>;

/** OpenAPI context a `{ type: schema }` assertion validates against (the matched operation). */
export interface ContractContext {
  doc: Record<string, unknown>;
  operation: SpecOperation;
}

/** A normalized view of an HTTP response that assertions run against. */
export interface ResponseView {
  status: number;
  headers: Record<string, string>; // keys lowercased
  bodyText: string;
  json?: unknown;
  durationMs: number;
}

export interface AssertionResult {
  type: TruSpecAssertion["type"] | "script";
  ok: boolean;
  message: string;
}

/** Structural equality for assertion `equals` comparisons. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    const aArr = Array.isArray(a);
    if (aArr !== Array.isArray(b)) return false;
    if (aArr && Array.isArray(b)) {
      return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
    }
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    return ak.length === bk.length && ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

const all = (checks: boolean[]): boolean => checks.length > 0 && checks.every(Boolean);

export function evaluateAssertion(a: ResponseAssertion, res: ResponseView): AssertionResult {
  switch (a.type) {
    case "status": {
      const checks: boolean[] = [];
      const desc: string[] = [];
      if (a.equals !== undefined) {
        checks.push(res.status === a.equals);
        desc.push(`== ${a.equals}`);
      }
      if (a.in !== undefined) {
        checks.push(a.in.includes(res.status));
        desc.push(`in [${a.in.join(", ")}]`);
      }
      if (a.lt !== undefined) {
        checks.push(res.status < a.lt);
        desc.push(`< ${a.lt}`);
      }
      if (a.gte !== undefined) {
        checks.push(res.status >= a.gte);
        desc.push(`>= ${a.gte}`);
      }
      const ok = all(checks);
      return {
        type: "status",
        ok,
        message: `status ${res.status} ${ok ? "satisfies" : "fails"} ${desc.join(" & ") || "(no condition)"}`,
      };
    }
    case "header": {
      const val = res.headers[a.name.toLowerCase()];
      const checks: boolean[] = [];
      if (a.exists !== undefined) checks.push((val !== undefined) === a.exists);
      if (a.equals !== undefined) checks.push(val === a.equals);
      if (a.matches !== undefined) checks.push(val !== undefined && new RegExp(a.matches).test(val));
      return { type: "header", ok: all(checks), message: `header "${a.name}": ${val ?? "(absent)"}` };
    }
    case "jsonpath": {
      let matches: unknown[];
      try {
        matches = res.json === undefined ? [] : jsonpath(res.json, a.path);
      } catch (e) {
        return { type: "jsonpath", ok: false, message: `jsonpath error: ${(e as Error).message}` };
      }
      const checks: boolean[] = [];
      if (a.exists !== undefined) checks.push((matches.length > 0) === a.exists);
      if (a.equals !== undefined) checks.push(matches.some((m) => deepEqual(m, a.equals)));
      if (a.matches !== undefined) {
        const re = new RegExp(a.matches);
        checks.push(matches.some((m) => re.test(String(m))));
      }
      return { type: "jsonpath", ok: all(checks), message: `jsonpath ${a.path} matched ${matches.length} value(s)` };
    }
    case "body": {
      const checks: boolean[] = [];
      if (a.contains !== undefined) checks.push(res.bodyText.includes(a.contains));
      if (a.matches !== undefined) checks.push(new RegExp(a.matches).test(res.bodyText));
      return { type: "body", ok: all(checks), message: all(checks) ? "body matched" : "body did not match" };
    }
    case "duration": {
      const ok = res.durationMs < a.ltMs;
      return { type: "duration", ok, message: `duration ${res.durationMs}ms ${ok ? "<" : ">="} ${a.ltMs}ms` };
    }
    default: {
      const exhaustive: never = a;
      throw new Error(`unknown assertion type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Validate the response body against the linked operation's OpenAPI response schema.
 * Without a spec (`contract` undefined) it reports a passing skip, so a collection stays
 * runnable spec-free. A status the spec doesn't document is a skip unless `required: true`.
 */
export function evaluateSchemaAssertion(
  a: Extract<TruSpecAssertion, { type: "schema" }>,
  res: ResponseView,
  contract: ContractContext | undefined,
): AssertionResult {
  if (!contract) {
    return { type: "schema", ok: true, message: "schema: no spec provided (skipped)" };
  }
  const status = a.status ?? res.status;
  const contentType = a.contentType ?? "application/json";
  const schema = responseSchemaFor(contract.operation, status, contentType);
  if (!schema) {
    const msg = `schema: no ${contentType} schema declared for status ${status} on ${contract.operation.key}`;
    return { type: "schema", ok: a.required !== true, message: `${msg}${a.required ? " (required)" : " (skipped)"}` };
  }
  if (res.json === undefined) {
    return { type: "schema", ok: false, message: "schema: response body is not valid JSON" };
  }
  const violations = validateAgainstSchema(res.json, schema, contract.doc);
  if (violations.length === 0) {
    return { type: "schema", ok: true, message: `schema: response conforms to ${contract.operation.key} (${status})` };
  }
  const shown = violations.slice(0, 5).map((v) => `${v.path || "(root)"}: ${v.message}`).join("; ");
  const more = violations.length > 5 ? ` (+${violations.length - 5} more)` : "";
  return { type: "schema", ok: false, message: `schema: ${violations.length} violation(s) — ${shown}${more}` };
}

export function evaluateAssertions(
  list: TruSpecAssertion[],
  res: ResponseView,
  contract?: ContractContext,
): AssertionResult[] {
  return list.map((a) => {
    try {
      return a.type === "schema" ? evaluateSchemaAssertion(a, res, contract) : evaluateAssertion(a, res);
    } catch (e) {
      // e.g. an invalid user-supplied regex in a `matches` assertion — fail just this
      // assertion instead of throwing out of the whole run.
      return { type: a.type, ok: false, message: `assertion error: ${(e as Error).message}` };
    }
  });
}
