import { parse as parseYaml } from "yaml";

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const;

export interface SpecOperation {
  method: string; // uppercased
  path: string;
  operationId?: string;
  /** Canonical key `${METHOD} ${path}`, e.g. "GET /pets/{id}". */
  key: string;
}

export interface OpenApiSummary {
  title?: string;
  version?: string;
  operations: SpecOperation[];
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
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
