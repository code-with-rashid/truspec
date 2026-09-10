import type { TruSpecAssertion } from "../format/types";
import { responseSchemaFor, type SpecOperation } from "../spec/openapi";
import { validateAgainstSchema } from "../spec/validate-response";
import { explainJsonPathMiss, jsonpath } from "./jsonpath";
import type { SseEvent } from "./sse";

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
  /** Parsed server-sent events, when the response was a `text/event-stream`. */
  events?: SseEvent[];
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

const all = (checks: Check[]): boolean => checks.length > 0 && checks.every((c) => c.ok);

/** One condition inside an assertion, kept with its description so a failure can name itself. */
interface Check {
  ok: boolean;
  /** Human phrasing of the condition, e.g. `== 200` or `has length 3`. */
  desc: string;
}

/**
 * Render a value for a failure message: short, unambiguous, and never a wall of text.
 * A CI log has to say *what it actually got*, not just that something did not match.
 */
function show(value: unknown, max = 120): string {
  if (value === undefined) return "(absent)";
  const text = typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value) ?? String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** JSON type name, distinguishing null and array from "object". */
function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Length of a string or array; `undefined` for anything else (so the check can fail honestly). */
function lengthOf(value: unknown): number | undefined {
  if (typeof value === "string" || Array.isArray(value)) return value.length;
  return undefined;
}

/** Emptiness across the three shapes it means something for. */
function isEmpty(value: unknown): boolean {
  if (typeof value === "string" || Array.isArray(value)) return value.length === 0;
  if (value && typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** Compose the summary line an assertion result carries. */
function summarize(subject: string, checks: Check[], ok: boolean): string {
  const conditions = checks.map((c) => c.desc).join(" & ") || "(no condition)";
  if (ok) return `${subject} satisfies ${conditions}`;
  const failed = checks.filter((c) => !c.ok).map((c) => c.desc);
  return `${subject} fails ${failed.length > 0 ? failed.join(" & ") : conditions}`;
}

/** Numeric comparators shared by the jsonpath assertion, as [field, symbol, predicate]. */
const NUMERIC_OPS: Array<["gt" | "gte" | "lt" | "lte", string, (v: number, b: number) => boolean]> = [
  ["gt", ">", (v, b) => v > b],
  ["gte", ">=", (v, b) => v >= b],
  ["lt", "<", (v, b) => v < b],
  ["lte", "<=", (v, b) => v <= b],
];

export function evaluateAssertion(a: ResponseAssertion, res: ResponseView): AssertionResult {
  switch (a.type) {
    case "status": {
      const checks: Check[] = [];
      if (a.equals !== undefined) checks.push({ ok: res.status === a.equals, desc: `== ${a.equals}` });
      if (a.in !== undefined) {
        checks.push({ ok: a.in.includes(res.status), desc: `in [${a.in.join(", ")}]` });
      }
      if (a.lt !== undefined) checks.push({ ok: res.status < a.lt, desc: `< ${a.lt}` });
      if (a.gte !== undefined) checks.push({ ok: res.status >= a.gte, desc: `>= ${a.gte}` });
      const ok = all(checks);
      return { type: "status", ok, message: summarize(`status ${res.status}`, checks, ok) };
    }
    case "header": {
      const val = res.headers[a.name.toLowerCase()];
      const checks: Check[] = [];
      if (a.exists !== undefined) {
        checks.push({ ok: (val !== undefined) === a.exists, desc: a.exists ? "exists" : "is absent" });
      }
      if (a.equals !== undefined) checks.push({ ok: val === a.equals, desc: `== ${show(a.equals)}` });
      if (a.notEquals !== undefined) {
        checks.push({ ok: val !== a.notEquals, desc: `!= ${show(a.notEquals)}` });
      }
      if (a.contains !== undefined) {
        checks.push({ ok: val !== undefined && val.includes(a.contains), desc: `contains ${show(a.contains)}` });
      }
      if (a.matches !== undefined) {
        checks.push({
          ok: val !== undefined && new RegExp(a.matches).test(val),
          desc: `matches /${a.matches}/`,
        });
      }
      const ok = all(checks);
      return { type: "header", ok, message: summarize(`header "${a.name}" ${show(val)}`, checks, ok) };
    }
    case "jsonpath": {
      let matches: unknown[];
      try {
        matches = res.json === undefined ? [] : jsonpath(res.json, a.path);
      } catch (e) {
        return { type: "jsonpath", ok: false, message: `jsonpath error: ${(e as Error).message}` };
      }
      const checks: Check[] = [];
      const some = (pred: (m: unknown) => boolean): boolean => matches.some(pred);
      if (a.exists !== undefined) {
        checks.push({ ok: (matches.length > 0) === a.exists, desc: a.exists ? "exists" : "is absent" });
      }
      if (a.equals !== undefined) {
        checks.push({ ok: some((m) => deepEqual(m, a.equals)), desc: `== ${show(a.equals)}` });
      }
      if (a.notEquals !== undefined) {
        checks.push({ ok: !some((m) => deepEqual(m, a.notEquals)), desc: `!= ${show(a.notEquals)}` });
      }
      if (a.matches !== undefined) {
        const re = new RegExp(a.matches);
        checks.push({ ok: some((m) => re.test(String(m))), desc: `matches /${a.matches}/` });
      }
      if (a.oneOf !== undefined) {
        checks.push({
          ok: some((m) => a.oneOf?.some((c) => deepEqual(m, c)) ?? false),
          desc: `one of ${show(a.oneOf)}`,
        });
      }
      if (a.contains !== undefined) {
        checks.push({
          ok: some((m) =>
            Array.isArray(m)
              ? m.some((el) => deepEqual(el, a.contains))
              : typeof m === "string" && typeof a.contains === "string" && m.includes(a.contains),
          ),
          desc: `contains ${show(a.contains)}`,
        });
      }
      for (const [key, op, test] of NUMERIC_OPS) {
        const bound = a[key];
        if (bound === undefined) continue;
        checks.push({
          ok: some((m) => typeof m === "number" && test(m, bound)),
          desc: `${op} ${bound}`,
        });
      }
      if (a.valueType !== undefined) {
        checks.push({ ok: some((m) => jsonTypeOf(m) === a.valueType), desc: `is a ${a.valueType}` });
      }
      if (a.length !== undefined) {
        checks.push({ ok: some((m) => lengthOf(m) === a.length), desc: `has length ${a.length}` });
      }
      if (a.minLength !== undefined) {
        const min = a.minLength;
        checks.push({ ok: some((m) => (lengthOf(m) ?? -1) >= min), desc: `has length >= ${min}` });
      }
      if (a.maxLength !== undefined) {
        const max = a.maxLength;
        checks.push({
          ok: some((m) => {
            const len = lengthOf(m);
            return len !== undefined && len <= max;
          }),
          desc: `has length <= ${max}`,
        });
      }
      if (a.empty !== undefined) {
        checks.push({ ok: some((m) => isEmpty(m) === a.empty), desc: a.empty ? "is empty" : "is not empty" });
      }
      const ok = all(checks);
      // Naming the value that was actually there is the difference between a log a human can act
      // on and one that only says something went wrong.
      // "(no match)" alone sends the reader off to open the body by hand. Say which step of the
      // path came up empty and what was there instead — a typo'd key names its siblings.
      const miss = matches.length === 0 ? explainJsonPathMiss(res.json, a.path) : undefined;
      const actual =
        matches.length === 0
          ? `(no match${miss ? ` — ${miss}` : ""})`
          : matches.length === 1
            ? show(matches[0])
            : show(matches);
      return { type: "jsonpath", ok, message: summarize(`jsonpath ${a.path} → ${actual}`, checks, ok) };
    }
    case "body": {
      const checks: Check[] = [];
      if (a.equals !== undefined) {
        checks.push({ ok: res.bodyText === a.equals, desc: `== ${show(a.equals)}` });
      }
      if (a.contains !== undefined) {
        checks.push({ ok: res.bodyText.includes(a.contains), desc: `contains ${show(a.contains)}` });
      }
      if (a.notContains !== undefined) {
        checks.push({
          ok: !res.bodyText.includes(a.notContains),
          desc: `does not contain ${show(a.notContains)}`,
        });
      }
      if (a.matches !== undefined) {
        checks.push({ ok: new RegExp(a.matches).test(res.bodyText), desc: `matches /${a.matches}/` });
      }
      if (a.empty !== undefined) {
        checks.push({ ok: (res.bodyText.length === 0) === a.empty, desc: a.empty ? "is empty" : "is not empty" });
      }
      const ok = all(checks);
      return { type: "body", ok, message: summarize(`body (${res.bodyText.length} bytes)`, checks, ok) };
    }
    case "duration": {
      const ok = res.durationMs < a.ltMs;
      return { type: "duration", ok, message: `duration ${res.durationMs}ms ${ok ? "<" : ">="} ${a.ltMs}ms` };
    }
    case "sse": {
      // A streaming response *is* its events. Asserting on the concatenated stream text works but
      // cannot say how many arrived or under which name — which is the whole question.
      const checks: Check[] = [];
      if (res.events === undefined) {
        return {
          type: "sse",
          ok: false,
          message: `sse — the response is not a text/event-stream (content-type: ${res.headers["content-type"] ?? "none"})`,
        };
      }
      const matching = a.event === undefined ? res.events : res.events.filter((e) => e.event === a.event);
      const scope = a.event === undefined ? "events" : `\`${a.event}\` events`;
      if (a.count !== undefined) checks.push({ ok: matching.length === a.count, desc: `count == ${a.count}` });
      if (a.minCount !== undefined) checks.push({ ok: matching.length >= a.minCount, desc: `count >= ${a.minCount}` });
      if (a.maxCount !== undefined) checks.push({ ok: matching.length <= a.maxCount, desc: `count <= ${a.maxCount}` });
      if (a.contains !== undefined) {
        const needle = a.contains;
        checks.push({ ok: matching.some((e) => e.data.includes(needle)), desc: `some data contains ${show(needle)}` });
      }
      if (a.matches !== undefined) {
        const re = new RegExp(a.matches);
        checks.push({ ok: matching.some((e) => re.test(e.data)), desc: `some data matches /${a.matches}/` });
      }
      if (a.jsonpath !== undefined) {
        const path = a.jsonpath;
        // Each event's `data` is its own document — an SSE stream is many small JSON values, not
        // one — so the path is evaluated per event and the assertion holds if any event satisfies it.
        const selected = matching.flatMap((e) => {
          let value: unknown;
          try {
            value = JSON.parse(e.data);
          } catch {
            return [];
          }
          try {
            return jsonpath(value, path);
          } catch {
            return [];
          }
        });
        if (a.exists !== undefined) {
          checks.push({ ok: selected.length > 0 === a.exists, desc: a.exists ? `${path} exists` : `${path} is absent` });
        }
        if (a.equals !== undefined) {
          checks.push({
            ok: selected.some((v) => deepEqual(v, a.equals)),
            desc: `${path} == ${show(a.equals)}`,
          });
        }
        if (a.exists === undefined && a.equals === undefined) {
          checks.push({ ok: selected.length > 0, desc: `${path} selects something` });
        }
      }
      if (checks.length === 0) checks.push({ ok: matching.length > 0, desc: "has at least one event" });
      const ok = all(checks);
      return { type: "sse", ok, message: summarize(`sse ${matching.length} ${scope}`, checks, ok) };
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
