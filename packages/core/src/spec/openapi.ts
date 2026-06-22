import { parse as parseYaml } from "yaml";
import { safeDecodeURIComponent } from "../util/uri";

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const;

export interface SpecParam {
  name: string;
  in: string; // query | path | header | cookie
  required: boolean;
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
  /** Declared response schemas (one entry per status × media type that carries a schema). */
  responses: SpecResponseSchema[];
}

export interface OpenApiSummary {
  title?: string;
  version?: string;
  operations: SpecOperation[];
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
    collected.set(`${p.in}:${p.name}`, { name: p.name, in: p.in, required: p.required === true });
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
        responses: extractResponses(op, doc),
      });
    }
  }
  operations.sort((a, b) => a.key.localeCompare(b.key));

  const info = asRecord(doc.info);
  return {
    title: typeof info?.title === "string" ? info.title : undefined,
    version: typeof info?.version === "string" ? info.version : undefined,
    operations,
  };
}
