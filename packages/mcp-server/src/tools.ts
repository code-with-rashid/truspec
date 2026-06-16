import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parse, type TruSpecMethod, type TruSpecRequest } from "@truspec/core/format";
import { slug } from "@truspec/core/importers";
import { coverageReport, driftReport, loadOpenApi } from "@truspec/core/spec";
import { discoverRequests, runPath } from "@truspec/core/workspace";

export interface ToolContext {
  cwd: string;
  fetch?: typeof globalThis.fetch;
}

const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export function listCollections(ctx: ToolContext, dir = ".") {
  const root = resolve(ctx.cwd, dir);
  const files = discoverRequests(root);
  const requests = files.map((file) => {
    const req = parse.request.parse(readFileSync(file, "utf8"));
    return {
      path: relative(ctx.cwd, file),
      name: req.name,
      method: req.method,
      url: req.url,
      operation: req.spec?.operationId ?? req.spec?.operation,
      assertions: req.assertions.length,
    };
  });
  return { dir: relative(ctx.cwd, root) || ".", count: requests.length, requests };
}

export async function runRequestTool(ctx: ToolContext, path: string, env?: string) {
  return runPath(resolve(ctx.cwd, path), { env, cwd: ctx.cwd, fetch: ctx.fetch });
}

export async function runCollectionTool(ctx: ToolContext, dir: string, env?: string) {
  return runPath(resolve(ctx.cwd, dir), { env, cwd: ctx.cwd, fetch: ctx.fetch });
}

export function createRequest(ctx: ToolContext, path: string, request: unknown) {
  const validation = parse.request.validate(request);
  if (!validation.ok || !validation.data) return { ok: false as const, error: validation.error };
  const abs = resolve(ctx.cwd, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, parse.request.serialize(validation.data));
  return { ok: true as const, path: relative(ctx.cwd, abs) };
}

export function updateRequest(ctx: ToolContext, path: string, patch: Record<string, unknown>) {
  const abs = resolve(ctx.cwd, path);
  if (!existsSync(abs)) return { ok: false as const, error: `Not found: ${path}` };
  const current = parse.request.parse(readFileSync(abs, "utf8"));
  const validation = parse.request.validate({ ...current, ...patch });
  if (!validation.ok || !validation.data) return { ok: false as const, error: validation.error };
  writeFileSync(abs, parse.request.serialize(validation.data));
  return { ok: true as const, path: relative(ctx.cwd, abs) };
}

export function driftTool(ctx: ToolContext, dir: string, specPath: string) {
  return driftReport(resolve(ctx.cwd, dir), resolve(ctx.cwd, specPath));
}

export function coverageTool(ctx: ToolContext, dir: string, specPath: string, minPercent = 0) {
  return coverageReport(resolve(ctx.cwd, dir), resolve(ctx.cwd, specPath), minPercent);
}

/** Scaffold a request stub for every operation in an OpenAPI spec (closes drift's "added" gap). */
export function scaffoldFromSpec(ctx: ToolContext, specPath: string, outDir: string, baseUrlVar = "baseUrl") {
  const summary = loadOpenApi(resolve(ctx.cwd, specPath));
  const files: string[] = [];
  const skipped: string[] = [];
  for (const op of summary.operations) {
    if (!VALID_METHODS.has(op.method)) {
      skipped.push(op.key);
      continue;
    }
    const request: TruSpecRequest = {
      tspec: "0.1",
      name: op.operationId ?? op.key,
      method: op.method as TruSpecMethod,
      url: `{{${baseUrlVar}}}${op.path.replace(/\{([^}]+)\}/g, "{{$1}}")}`,
      assertions: [{ type: "status", equals: 200 }],
      spec: { operation: op.key, operationId: op.operationId },
    };
    const abs = resolve(ctx.cwd, outDir, `${slug(op.operationId ?? op.key)}.tspec.yaml`);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, parse.request.serialize(request));
    files.push(relative(ctx.cwd, abs));
  }
  return { created: files.length, files, skipped };
}
