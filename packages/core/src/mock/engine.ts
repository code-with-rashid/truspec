import { parse as parseYaml } from "yaml";
import { asRecord, parseOpenApi, resolveRef } from "../spec/openapi";
import { validateAgainstSchema } from "../spec/validate-response";

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"] as const;

export interface MockRoute {
  method: string;
  pathTemplate: string;
  regex: RegExp;
  status: number;
  body: unknown;
  contentType?: string;
}

export interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** A schema keyword read as a finite number, or undefined when absent or not numeric. */
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function stringExample(schema: Record<string, unknown>): string {
  let out: string;
  switch (schema.format) {
    case "date-time":
      out = "2026-01-01T00:00:00Z";
      break;
    case "date":
      out = "2026-01-01";
      break;
    case "uuid":
      out = "00000000-0000-0000-0000-000000000000";
      break;
    case "email":
      out = "user@example.com";
      break;
    case "uri":
      out = "https://example.com";
      break;
    default:
      out = "string";
  }
  // A formatted placeholder is a fixed length, so honour the bounds only for the plain case —
  // padding a date-time to `minLength: 40` would produce something that is no longer a date-time.
  if (schema.format === undefined) {
    const min = num(schema.minLength);
    const max = num(schema.maxLength);
    if (min !== undefined && out.length < min) out = out.padEnd(min, "x");
    if (max !== undefined && out.length > max) out = out.slice(0, max);
  }
  return out;
}

/**
 * A number inside the schema's bounds.
 *
 * The generator returned a flat `0`, which violates the extremely ordinary `minimum: 1` — and
 * since the response validator did not check bounds either, `truspec mock` and `truspec contract`
 * agreed on a response that the spec forbids. Fixing only the validator would have left the
 * documented `gen` → `mock` → `contract` workflow failing out of the box.
 */
function numberExample(schema: Record<string, unknown>): number {
  const isInt = schema.type === "integer";
  const step = isInt ? 1 : 0;
  let out = 0;
  const min = num(schema.minimum);
  const max = num(schema.maximum);
  const exMin = num(schema.exclusiveMinimum);
  const exMax = num(schema.exclusiveMaximum);
  if (min !== undefined) out = schema.exclusiveMinimum === true ? min + (step || 1e-6) : min;
  if (exMin !== undefined) out = Math.max(out, exMin + (step || 1e-6));
  if (max !== undefined && out > max) out = schema.exclusiveMaximum === true ? max - (step || 1e-6) : max;
  if (exMax !== undefined && out >= exMax) out = exMax - (step || 1e-6);
  const multiple = num(schema.multipleOf);
  if (multiple !== undefined && multiple > 0) {
    // Round *up* to the next multiple so a `minimum` is never undercut by the rounding itself.
    const rounded = Math.ceil(out / multiple - 1e-9) * multiple;
    if (max === undefined || rounded <= max) out = rounded;
  }
  const result = isInt ? Math.round(out) : out;
  // `Math.ceil(0 / 5 - 1e-9) * 5` is -0, and a generated example should not carry a negative zero.
  return Object.is(result, -0) ? 0 : result;
}

/** Generate a deterministic example value from a JSON Schema (OpenAPI subset). */
export function generateExample(schema: Record<string, unknown>, doc: Record<string, unknown>, depth = 0): unknown {
  if (depth > 6) return null;
  if (typeof schema.$ref === "string") {
    const resolved = resolveRef(schema.$ref, doc);
    return resolved ? generateExample(resolved, doc, depth + 1) : null;
  }
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  if (Array.isArray(schema.allOf)) {
    const merged: Record<string, unknown> = {};
    for (const part of schema.allOf) {
      const ex = generateExample(asRecord(part) ?? {}, doc, depth + 1);
      if (ex && typeof ex === "object") Object.assign(merged, ex);
    }
    return merged;
  }
  const union = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(union) && union.length > 0) {
    return generateExample(asRecord(union[0]) ?? {}, doc, depth + 1);
  }

  if (schema.type === "object" || schema.properties) {
    const props = asRecord(schema.properties) ?? {};
    const obj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      obj[key] = generateExample(asRecord(value) ?? {}, doc, depth + 1);
    }
    return obj;
  }
  if (schema.type === "array") {
    // One item satisfied the old generator and violates any `minItems` above 1.
    const count = Math.max(1, num(schema.minItems) ?? 1);
    const capped = Math.min(count, num(schema.maxItems) ?? count);
    const items = asRecord(schema.items) ?? {};
    return Array.from({ length: capped }, () => generateExample(items, doc, depth + 1));
  }
  if (schema.type === "string") return stringExample(schema);
  if (schema.type === "integer" || schema.type === "number") return numberExample(schema);
  if (schema.type === "boolean") return true;
  return null;
}

function pathToRegex(path: string): RegExp {
  let out = "^";
  let prevWasParam = false;
  for (const part of path.split(/(\{[^}]+\})/g)) {
    if (part === "") continue;
    if (/^\{[^}]+\}$/.test(part)) {
      // Collapse a run of adjacent params (no literal separator between them) into a SINGLE
      // unbounded segment. Emitting `[^/]+[^/]+…` — two+ greedy quantifiers over the same class
      // with nothing between — backtracks catastrophically (O(n^k)) on a long non-matching path,
      // and the mock matches attacker-controlled request paths on the event loop → a DoS.
      // Adjacent params are inherently ambiguous to split anyway, so one `[^/]+` is the right match.
      // Groups are non-capturing because the regex is only ever used for `.test()`.
      if (!prevWasParam) out += "[^/]+";
      prevWasParam = true;
    } else {
      out += part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      prevWasParam = false;
    }
  }
  return new RegExp(`${out}/?$`);
}

/**
 * Pick the more specific of two path templates by comparing segment-by-segment: a literal segment
 * (`me`) beats a parameter (`{id}`) at the same position. Returns >0 when `a` is more specific than
 * `b`. So when several routes match a path, the static one wins over the parametric one regardless
 * of declaration order — `/users/me` must not be shadowed by an earlier `/users/{id}`.
 */
function compareSpecificity(a: string, b: string): number {
  const score = (seg: string | undefined): number => (seg === undefined ? -1 : /^\{[^}]+\}$/.test(seg) ? 0 : 1);
  const sa = a.split("/");
  const sb = b.split("/");
  const n = Math.max(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    const d = score(sa[i]) - score(sb[i]);
    if (d !== 0) return d;
  }
  return 0;
}

function pickResponse(op: Record<string, unknown>, doc: Record<string, unknown>): {
  status: number;
  body: unknown;
  contentType?: string;
} {
  const responses = asRecord(op.responses) ?? {};
  const codes = Object.keys(responses);
  const success = codes.filter((c) => /^2\d\d$/.test(c)).sort();
  const chosen = success[0] ?? (responses.default !== undefined ? "default" : codes[0]);
  const parsed = chosen && /^\d+$/.test(chosen) ? Number(chosen) : 200;
  // Clamp to a valid FINAL HTTP status (200–599). Two failure modes this guards:
  //  • out-of-range codes ("20000", "99", "0") make `res.writeHead` throw `Invalid status code` →
  //    in an unguarded handler that crashes the mock process;
  //  • a 1xx INTERIM code ("100"/"101") sent as the final response makes HTTP clients hang waiting
  //    for the real response (fetch times out).
  // A mock sends one complete response, so a non-final status is meaningless → fall back to 200.
  const status = parsed >= 200 && parsed <= 599 ? parsed : 200;

  const response = asRecord(chosen ? responses[chosen] : undefined) ?? {};
  const content = asRecord(response.content);
  const json = asRecord(content?.["application/json"]);
  if (!json) return { status, body: undefined };

  if (json.example !== undefined) return { status, body: json.example, contentType: "application/json" };
  const examples = asRecord(json.examples);
  if (examples) {
    const first = asRecord(Object.values(examples)[0]);
    if (first && "value" in first) return { status, body: first.value, contentType: "application/json" };
  }
  const schema = asRecord(json.schema);
  if (schema) return { status, body: generateExample(schema, doc), contentType: "application/json" };
  return { status, body: undefined, contentType: "application/json" };
}

export function buildRoutes(doc: Record<string, unknown>): MockRoute[] {
  const routes: MockRoute[] = [];
  const paths = asRecord(doc.paths) ?? {};
  for (const [path, rawItem] of Object.entries(paths)) {
    const item = asRecord(rawItem);
    if (!item) continue;
    for (const method of METHODS) {
      const op = asRecord(item[method]);
      if (!op) continue;
      const { status, body, contentType } = pickResponse(op, doc);
      routes.push({ method: method.toUpperCase(), pathTemplate: path, regex: pathToRegex(path), status, body, contentType });
    }
  }
  return routes;
}

export interface MockRequestInfo {
  query?: Record<string, string>;
  hasBody?: boolean;
  /** The raw request body, when the caller read one. Needed to check it against the spec. */
  bodyText?: string;
  contentType?: string;
}

export interface MockResponder {
  routes: MockRoute[];
  respond(method: string, path: string, info?: MockRequestInfo): MockResponse | undefined;
}

export interface MockResponderOptions {
  /** Validate incoming requests against the spec; respond 400 when they don't satisfy it. */
  validate?: boolean;
}

/** JSON bodies only: a form or multipart body has no JSON Schema to check it against here. */
function isJsonBody(contentType: string | undefined): boolean {
  return contentType === undefined || contentType === "" || /json/i.test(contentType);
}

/**
 * Check a request body against the schema its operation declares.
 *
 * Returns a 400 describing every violation, or `undefined` when the body conforms (or when there
 * is nothing to check: no schema, no body read, or a non-JSON media type).
 */
function validateRequestBody(
  schema: Record<string, unknown> | undefined,
  info: MockRequestInfo | undefined,
  doc: Record<string, unknown>,
): MockResponse | undefined {
  if (!schema || info?.bodyText === undefined || info.bodyText === "") return undefined;
  if (!isJsonBody(info.contentType)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(info.bodyText);
  } catch {
    return {
      status: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Request body is not valid JSON" }),
    };
  }
  const violations = validateAgainstSchema(value, schema, doc);
  if (violations.length === 0) return undefined;
  return {
    status: 400,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      error: "Request body does not satisfy the spec",
      violations: violations.map((v) => ({ path: v.path || "/", message: v.message })),
    }),
  };
}

/** Build a stateless mock responder from OpenAPI text (YAML or JSON). */
export function createMockResponder(specText: string, opts: MockResponderOptions = {}): MockResponder {
  const doc = asRecord(parseYaml(specText)) ?? {};
  const routes = buildRoutes(doc);

  const rules = new Map<
    string,
    { requiredQuery: string[]; bodyRequired: boolean; bodySchema?: Record<string, unknown> }
  >();
  if (opts.validate) {
    for (const op of parseOpenApi(specText).operations) {
      rules.set(op.key, {
        requiredQuery: op.parameters.filter((p) => p.in === "query" && p.required).map((p) => p.name),
        bodyRequired: op.requestBodyRequired,
        ...(op.requestBodySchema ? { bodySchema: op.requestBodySchema } : {}),
      });
    }
  }

  return {
    routes,
    respond(method, path, info) {
      const m = method.toUpperCase();
      // Among all routes that match, prefer the most specific template (static beats parametric),
      // not merely the first in document order.
      const pick = (want: string): MockRoute | undefined => {
        let best: MockRoute | undefined;
        for (const r of routes) {
          if (r.method !== want || !r.regex.test(path)) continue;
          if (!best || compareSpecificity(r.pathTemplate, best.pathTemplate) > 0) best = r;
        }
        return best;
      };

      // HEAD is GET without the body (RFC 9110 9.3.2). A spec almost never declares HEAD
      // explicitly, so without this the mock 404s the existence check plenty of clients make
      // before a GET — and a `method: HEAD` request in a collection could never be mocked at all.
      const headOnly = m === "HEAD" && pick("HEAD") === undefined;
      const route = headOnly ? pick("GET") : pick(m);

      if (!route) {
        // The path is defined, just not for this method. 404 reads as "wrong URL" and sends the
        // reader looking in the wrong place; 405 with `Allow` says what the spec does define.
        const allowed = new Set<string>();
        for (const r of routes) if (r.regex.test(path)) allowed.add(r.method);
        if (allowed.has("GET")) allowed.add("HEAD");
        if (allowed.size === 0) return undefined;
        const allow = [...allowed].sort();
        return {
          status: 405,
          headers: { "content-type": "application/json", allow: allow.join(", ") },
          body: JSON.stringify({ error: `${m} is not defined for ${path}`, allow }),
        };
      }

      const rule = rules.get(`${route.method} ${route.pathTemplate}`);
      if (rule) {
        const missing: string[] = [];
        for (const q of rule.requiredQuery) if (!info?.query?.[q]) missing.push(`query:${q}`);
        if (rule.bodyRequired && !info?.hasBody) missing.push("body");
        if (missing.length > 0) {
          return {
            status: 400,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ error: "Request does not satisfy the spec", missing }),
          };
        }
        // Whether the body *satisfies* its schema, not merely whether one was sent. A mock that
        // accepts `{"name": 1}` against `name: string` is agreeing with a request the real API
        // will reject — which is the one thing a spec-backed mock exists to prevent.
        const bad = validateRequestBody(rule.bodySchema, info, doc);
        if (bad) return bad;
      }

      const headers: Record<string, string> = {};
      let body = "";
      if (route.body !== undefined) {
        headers["content-type"] = route.contentType ?? "application/json";
        body = JSON.stringify(route.body);
      }
      if (headOnly) {
        // The headers GET would have sent, including the size of the body it would have sent.
        headers["content-length"] = String(new TextEncoder().encode(body).length);
        body = "";
      }
      return { status: route.status, headers, body };
    },
  };
}
