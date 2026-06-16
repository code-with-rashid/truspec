import { parse as parseYaml } from "yaml";
import { safeDecodeURIComponent } from "../util/uri";

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const;

export interface SpecParam {
  name: string;
  in: string; // query | path | header | cookie
  required: boolean;
}

export interface SpecOperation {
  method: string; // uppercased
  path: string;
  operationId?: string;
  /** Canonical key `${METHOD} ${path}`, e.g. "GET /pets/{id}". */
  key: string;
  parameters: SpecParam[];
  requestBodyRequired: boolean;
}

export interface OpenApiSummary {
  title?: string;
  version?: string;
  operations: SpecOperation[];
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function resolveRef(ref: string, doc: Record<string, unknown>): Record<string, unknown> | undefined {
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
