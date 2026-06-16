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
  for (const op of summary.operations) {
    if (!VALID_METHODS.has(op.method)) {
      skipped.push(op.key);
      continue;
    }
    const request: TruSpecRequest = {
      tspec: SCHEMA_VERSION,
      name: op.operationId ?? op.key,
      method: op.method as TruSpecMethod,
      url: `{{${baseUrlVar}}}${op.path.replace(/\{([^}]+)\}/g, "{{$1}}")}`,
      assertions: [{ type: "status", equals: 200 }],
      spec: { operation: op.key, operationId: op.operationId },
    };
    files.push({
      path: `${slug(op.operationId ?? op.key)}.tspec.yaml`,
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
