import { parse as parseYaml } from "yaml";

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

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** Resolve a local `#/components/schemas/Name` reference within the document. */
function resolveRef(ref: string, doc: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = doc;
  for (const segment of ref.slice(2).split("/")) {
    const rec = asRecord(node);
    if (!rec) return undefined;
    node = rec[decodeURIComponent(segment)];
  }
  return asRecord(node);
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
  for (const part of path.split(/(\{[^}]+\})/g)) {
    if (/^\{[^}]+\}$/.test(part)) out += "([^/]+)";
    else out += part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}/?$`);
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
  const status = chosen && /^\d+$/.test(chosen) ? Number(chosen) : 200;

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

export interface MockResponder {
  routes: MockRoute[];
  respond(method: string, path: string): MockResponse | undefined;
}

/** Build a stateless mock responder from OpenAPI text (YAML or JSON). */
export function createMockResponder(specText: string): MockResponder {
  const doc = asRecord(parseYaml(specText)) ?? {};
  const routes = buildRoutes(doc);
  return {
    routes,
    respond(method, path) {
      const m = method.toUpperCase();
      const route = routes.find((r) => r.method === m && r.regex.test(path));
      if (!route) return undefined;
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
