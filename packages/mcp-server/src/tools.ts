import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parse } from "@truspec/core/format";
import {
  coverageReport,
  driftReport,
  liveDriftReport,
  scaffoldFromSpec as coreScaffold,
  writeScaffold,
} from "@truspec/core/spec";
import { confinePath, discoverRequests, runPath } from "@truspec/core/workspace";

export interface ToolContext {
  cwd: string;
  fetch?: typeof globalThis.fetch;
}

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
  const abs = confinePath(ctx.cwd, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, parse.request.serialize(validation.data));
  return { ok: true as const, path: relative(ctx.cwd, abs) };
}

export function updateRequest(ctx: ToolContext, path: string, patch: Record<string, unknown>) {
  const abs = confinePath(ctx.cwd, path);
  if (!existsSync(abs)) return { ok: false as const, error: `Not found: ${path}` };
  const current = parse.request.parse(readFileSync(abs, "utf8"));
  const validation = parse.request.validate({ ...current, ...patch });
  if (!validation.ok || !validation.data) return { ok: false as const, error: validation.error };
  writeFileSync(abs, parse.request.serialize(validation.data));
  return { ok: true as const, path: relative(ctx.cwd, abs) };
}

export async function driftTool(ctx: ToolContext, dir: string, specPath: string, live?: string) {
  const d = resolve(ctx.cwd, dir);
  const s = resolve(ctx.cwd, specPath);
  return live ? liveDriftReport(d, s, live, { fetch: ctx.fetch }) : driftReport(d, s);
}

export function coverageTool(ctx: ToolContext, dir: string, specPath: string, minPercent = 0) {
  return coverageReport(resolve(ctx.cwd, dir), resolve(ctx.cwd, specPath), minPercent);
}

/** Scaffold a request stub for every operation in an OpenAPI spec (closes drift's "added" gap). */
export function scaffoldFromSpec(ctx: ToolContext, specPath: string, outDir: string, baseUrlVar = "baseUrl") {
  const specText = readFileSync(resolve(ctx.cwd, specPath), "utf8");
  const result = coreScaffold(specText, { baseUrlVar });
  const written = writeScaffold(result.files, confinePath(ctx.cwd, outDir));
  return {
    created: written.length,
    files: written.map((p) => relative(ctx.cwd, p)),
    skipped: result.skipped,
  };
}
