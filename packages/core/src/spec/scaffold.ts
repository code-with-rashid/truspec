import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "../format";
import { SCHEMA_VERSION } from "../format/schema";
import type { TruSpecMethod, TruSpecRequest } from "../format/types";
import { parseOpenApi } from "./openapi";

const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "request"
  );
}

export interface ScaffoldFile {
  path: string;
  content: string;
}

export interface ScaffoldResult {
  files: ScaffoldFile[];
  skipped: string[];
}

/** Generate a request stub (status-200 assertion + spec link) for each spec operation. */
export function scaffoldFromSpec(specText: string, opts: { baseUrlVar?: string } = {}): ScaffoldResult {
  const summary = parseOpenApi(specText);
  const baseUrlVar = opts.baseUrlVar ?? "baseUrl";
  const files: ScaffoldFile[] = [];
  const skipped: string[] = [];
  // Distinct operations can slug to the same base (case-variant operationIds like
  // `getUser`/`GetUser`, or paths differing only in separators like `/a-b` vs `/a/b`). Without a
  // uniqueness counter the second file would overwrite the first on disk — silently dropping
  // operations from a per-operation scaffold. Mirror the Postman importer: suffix `-2`, `-3`, …
  const used = new Map<string, number>();
  for (const op of summary.operations) {
    if (!VALID_METHODS.has(op.method)) {
      skipped.push(op.key);
      continue;
    }
    // `|| op.key` (not `??`): an operation can declare an EMPTY-string operationId, which `??` would
    // keep — and an empty `name` fails the request schema's `name.min(1)`, throwing out of the whole
    // `gen`. `op.key` (`${METHOD} ${path}`) is always non-empty. Likewise omit an empty operationId
    // from the spec link rather than writing `operationId: ""`.
    const label = op.operationId || op.key;
    const request: TruSpecRequest = {
      tspec: SCHEMA_VERSION,
      name: label,
      method: op.method as TruSpecMethod,
      url: `{{${baseUrlVar}}}${op.path.replace(/\{([^}]+)\}/g, "{{$1}}")}`,
      assertions: [{ type: "status", equals: 200 }],
      spec: { operation: op.key, operationId: op.operationId || undefined },
    };
    const base = slug(label);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    files.push({
      path: `${n > 1 ? `${base}-${n}` : base}.tspec.yaml`,
      content: parse.request.serialize(request),
    });
  }
  return { files, skipped };
}

/** Write a scaffold result to disk under `outDir`; returns the paths written. */
export function writeScaffold(files: ScaffoldFile[], outDir: string): string[] {
  const written: string[] = [];
  for (const f of files) {
    const p = join(outDir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
    written.push(p);
  }
  return written;
}
