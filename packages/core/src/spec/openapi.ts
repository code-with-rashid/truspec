import { parse as parseYaml } from "yaml";
import { safeDecodeURIComponent } from "../util/uri";

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const;

export interface SpecParam {
  name: string;
  in: string; // query | path | header | cookie
  required: boolean;
  /**
   * A usable example value, from the parameter's own `example`, its schema's
   * `example`/`default`/first `enum`, or a type-appropriate placeholder. Consumers that need to
   * *run* a scaffolded request (rather than just describe it) need something to put in the URL.
   */
  sample?: string;
}

/** A response schema declared by an operation, for one status × media type. */
export interface SpecResponseSchema {
  status: string; // "200" | "201" | "default"
  contentType: string; // e.g. "application/json"
  /** JSON Schema (OpenAPI 3 subset); may still contain `$ref`, resolved at validation time. */
  schema: Record<string, unknown>;
}

export interface SpecOperation {
  method: string; // uppercased
  path: string;
  operationId?: string;
  /** Canonical key `${METHOD} ${path}`, e.g. "GET /pets/{id}". */
  key: string;
  parameters: SpecParam[];
  requestBodyRequired: boolean;
  /**
   * The JSON schema of a required request body, when the operation declares one.
   *
   * `gen` needs it to scaffold a body that satisfies the spec — without it, a generated POST omits
   * the body its own operation requires, and `drift` immediately reports the collection it just
   * produced as drifted.
   */
  requestBodySchema?: Record<string, unknown>;
  /** Declared response schemas (one entry per status × media type that carries a schema). */
  responses: SpecResponseSchema[];
  /**
   * The lowest 2xx status the operation documents, if any. A scaffolded request has to assert
   * *the spec's own* success status — asserting a blanket 200 against an operation the spec says
   * returns 201 generates a request that fails on its first run.
   */
  successStatus?: number;
}

export interface OpenApiSummary {
  title?: string;
  version?: string;
  operations: SpecOperation[];
  /**
   * The parsed document, for consumers that must resolve a `$ref` reached from an operation's
   * schema — `gen` scaffolding a request body, for one. Callers that only want the operation list
   * can ignore it.
   */
  document: Record<string, unknown>;
}

export function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** Resolve a local `#/...` JSON reference within the document (shared with the mock engine). */
export function resolveRef(ref: string, doc: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = doc;
  for (const segment of ref.slice(2).split("/")) {
    const rec = asRecord(node);
    if (!rec) return undefined;
    node = rec[safeDecodeURIComponent(segment)];
  }
  return asRecord(node);
}

/** Derive a concrete example value for a parameter, preferring what the spec actually says. */
function sampleForParam(param: Record<string, unknown>, doc: Record<string, unknown>): string | undefined {
  if (param.example !== undefined && typeof param.example !== "object") return String(param.example);
  let schema = asRecord(param.schema);
  if (schema && typeof schema.$ref === "string") schema = resolveRef(schema.$ref, doc);
  if (!schema) return undefined;
  for (const key of ["example", "default"] as const) {
    const v = schema[key];
    if (v !== undefined && typeof v !== "object") return String(v);
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && typeof schema.enum[0] !== "object") {
    return String(schema.enum[0]);
  }
  switch (schema.type) {
    case "integer":
    case "number":
      return "1";
    case "boolean":
      return "true";
    case "string":
      // A format-appropriate placeholder beats a bare "example" that would 404 or 400 on sight.
      if (schema.format === "uuid") return "00000000-0000-4000-8000-000000000000";
      if (schema.format === "date") return "2026-01-01";
      if (schema.format === "date-time") return "2026-01-01T00:00:00Z";
      return "example";
    default:
      return undefined;
  }
}

/** Collect path-item + operation parameters (deduped, $ref-resolved). */
function extractParams(
  pathItem: Record<string, unknown>,
  op: Record<string, unknown>,
  doc: Record<string, unknown>,
): SpecParam[] {
  const collected = new Map<string, SpecParam>();
  const add = (raw: unknown): void => {
    let p = asRecord(raw);
    if (p && typeof p.$ref === "string") p = resolveRef(p.$ref, doc);
    if (!p || typeof p.name !== "string" || typeof p.in !== "string") return;
    collected.set(`${p.in}:${p.name}`, {
      name: p.name,
      in: p.in,
      required: p.required === true,
      ...(sampleForParam(p, doc) !== undefined ? { sample: sampleForParam(p, doc) } : {}),
    });
  };
  if (Array.isArray(pathItem.parameters)) for (const x of pathItem.parameters) add(x);
  if (Array.isArray(op.parameters)) for (const x of op.parameters) add(x);
  return [...collected.values()];
}

function isRequestBodyRequired(op: Record<string, unknown>, doc: Record<string, unknown>): boolean {
  let rb = asRecord(op.requestBody);
  if (rb && typeof rb.$ref === "string") rb = resolveRef(rb.$ref, doc);
  return rb?.required === true;
}

/** The JSON schema a request body should satisfy, preferring `application/json`. */
function requestBodySchemaOf(
  op: Record<string, unknown>,
  doc: Record<string, unknown>,
): Record<string, unknown> | undefined {
  let rb = asRecord(op.requestBody);
  if (rb && typeof rb.$ref === "string") rb = resolveRef(rb.$ref, doc);
  const content = asRecord(rb?.content);
  if (!content) return undefined;
  const key =
    Object.keys(content).find((k) => k.toLowerCase().includes("json")) ?? Object.keys(content)[0];
  if (key === undefined) return undefined;
  return asRecord(asRecord(content[key])?.schema);
}

/** The lowest documented 2xx status, across every declared response (schema-bearing or not). */
function successStatusOf(op: Record<string, unknown>): number | undefined {
  const responses = asRecord(op.responses);
  if (!responses) return undefined;
  const codes = Object.keys(responses)
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n) && n >= 200 && n < 300)
    .sort((a, b) => a - b);
  return codes[0];
}

/** Collect every declared response schema (status × media type) for an operation. */
function extractResponses(op: Record<string, unknown>, doc: Record<string, unknown>): SpecResponseSchema[] {
  const responses = asRecord(op.responses);
  if (!responses) return [];
  const out: SpecResponseSchema[] = [];
  for (const [status, rawResp] of Object.entries(responses)) {
    let resp = asRecord(rawResp);
    if (resp && typeof resp.$ref === "string") resp = resolveRef(resp.$ref, doc);
    const content = asRecord(resp?.content);
    if (!content) continue;
    for (const [contentType, rawMedia] of Object.entries(content)) {
      const schema = asRecord(asRecord(rawMedia)?.schema);
      if (schema) out.push({ status, contentType, schema });
    }
  }
  return out;
}

/**
 * The response schema an operation declares for a given status + media type.
 * Falls back to the `default` response, then `undefined` (no schema to validate against).
 */
export function responseSchemaFor(
  op: SpecOperation,
  status: number,
  contentType = "application/json",
): Record<string, unknown> | undefined {
  const exact = op.responses.find((r) => r.status === String(status) && r.contentType === contentType);
  if (exact) return exact.schema;
  return op.responses.find((r) => r.status === "default" && r.contentType === contentType)?.schema;
}

/** Parse an OpenAPI 3 document (YAML or JSON) into a flat list of operations. */
export function parseOpenApi(text: string): OpenApiSummary {
  const doc = asRecord(parseYaml(text));
  if (!doc) throw new Error("Invalid OpenAPI document: expected an object at the root");

  const paths = asRecord(doc.paths) ?? {};
  const operations: SpecOperation[] = [];
  for (const [path, rawItem] of Object.entries(paths)) {
    const item = asRecord(rawItem);
    if (!item) continue;
    for (const method of METHODS) {
      const op = asRecord(item[method]);
      if (!op) continue;
      const M = method.toUpperCase();
      operations.push({
        method: M,
        path,
        operationId: typeof op.operationId === "string" ? op.operationId : undefined,
        key: `${M} ${path}`,
        parameters: extractParams(item, op, doc),
        requestBodyRequired: isRequestBodyRequired(op, doc),
        ...(() => {
          const schema = requestBodySchemaOf(op, doc);
          return schema ? { requestBodySchema: schema } : {};
        })(),
        responses: extractResponses(op, doc),
        ...(successStatusOf(op) !== undefined ? { successStatus: successStatusOf(op) } : {}),
      });
    }
  }
  operations.sort((a, b) => a.key.localeCompare(b.key));

  const info = asRecord(doc.info);
  return {
    title: typeof info?.title === "string" ? info.title : undefined,
    version: typeof info?.version === "string" ? info.version : undefined,
    operations,
    document: doc,
  };
}
