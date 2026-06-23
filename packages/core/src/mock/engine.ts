import { parse as parseYaml } from "yaml";
import { asRecord, parseOpenApi, resolveRef } from "../spec/openapi";

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

function stringExample(schema: Record<string, unknown>): string {
  switch (schema.format) {
    case "date-time":
      return "2026-01-01T00:00:00Z";
    case "date":
      return "2026-01-01";
    case "uuid":
      return "00000000-0000-0000-0000-000000000000";
    case "email":
      return "user@example.com";
    case "uri":
      return "https://example.com";
    default:
      return "string";
  }
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
    return [generateExample(asRecord(schema.items) ?? {}, doc, depth + 1)];
  }
  if (schema.type === "string") return stringExample(schema);
  if (schema.type === "integer" || schema.type === "number") return 0;
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
}

export interface MockResponder {
  routes: MockRoute[];
  respond(method: string, path: string, info?: MockRequestInfo): MockResponse | undefined;
}

export interface MockResponderOptions {
  /** Validate incoming requests against the spec; respond 400 when they don't satisfy it. */
  validate?: boolean;
}

/** Build a stateless mock responder from OpenAPI text (YAML or JSON). */
export function createMockResponder(specText: string, opts: MockResponderOptions = {}): MockResponder {
  const doc = asRecord(parseYaml(specText)) ?? {};
  const routes = buildRoutes(doc);

  const rules = new Map<string, { requiredQuery: string[]; bodyRequired: boolean }>();
  if (opts.validate) {
    for (const op of parseOpenApi(specText).operations) {
      rules.set(op.key, {
        requiredQuery: op.parameters.filter((p) => p.in === "query" && p.required).map((p) => p.name),
        bodyRequired: op.requestBodyRequired,
      });
    }
  }

  return {
    routes,
    respond(method, path, info) {
      const m = method.toUpperCase();
      // Among all routes that match, prefer the most specific template (static beats parametric),
      // not merely the first in document order.
      let route: MockRoute | undefined;
      for (const r of routes) {
        if (r.method !== m || !r.regex.test(path)) continue;
        if (!route || compareSpecificity(r.pathTemplate, route.pathTemplate) > 0) route = r;
      }
      if (!route) return undefined;

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
      }

      const headers: Record<string, string> = {};
      let body = "";
      if (route.body !== undefined) {
        headers["content-type"] = route.contentType ?? "application/json";
        body = JSON.stringify(route.body);
      }
      return { status: route.status, headers, body };
    },
  };
}
