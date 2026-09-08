import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { CODEGEN_TARGETS, codegenTargetIds, generateCode } from "@truspec/core/codegen";
import { parse } from "@truspec/core/format";
import {
  contractReport,
  coverageReport,
  driftReport,
  liveDriftReport,
  scaffoldFromSpec as coreScaffold,
  writeScaffold,
} from "@truspec/core/spec";
import { confinePath, discoverRequests, prepareRequest, runPath } from "@truspec/core/workspace";

export interface ToolContext {
  cwd: string;
  fetch?: typeof globalThis.fetch;
}

export function listCollections(ctx: ToolContext, dir = ".") {
  const root = resolve(ctx.cwd, dir);
  const files = discoverRequests(root);
  const requests: Array<Record<string, unknown>> = [];
  // One malformed file must NOT abort the whole listing — otherwise an agent/UI can't see any of
  // the collection to even find (let alone fix) the broken file. Report bad files with their path
  // so the failure is diagnosable, and still list the rest.
  const errors: Array<{ path: string; error: string }> = [];
  for (const file of files) {
    const path = relative(ctx.cwd, file);
    try {
      const req = parse.request.parse(readFileSync(file, "utf8"));
      requests.push({
        path,
        name: req.name,
        method: req.method,
        url: req.url,
        operation: req.spec?.operationId ?? req.spec?.operation,
        assertions: req.assertions.length,
      });
    } catch (e) {
      errors.push({ path, error: (e as Error).message });
    }
  }
  return {
    dir: relative(ctx.cwd, root) || ".",
    count: requests.length,
    requests,
    ...(errors.length > 0 ? { errors } : {}),
  };
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

/** Run the collection and validate each response against its OpenAPI response schema. */
export async function contractTool(ctx: ToolContext, dir: string, specPath: string, env?: string) {
  return contractReport(resolve(ctx.cwd, dir), resolve(ctx.cwd, specPath), { env, cwd: ctx.cwd, fetch: ctx.fetch });
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

/**
 * Render a request as a runnable snippet in another client/language. An agent asked to "show me
 * how to call this from Python" should not have to hand-assemble the URL, folder-inherited
 * headers and auth — this returns exactly what the runner would send.
 */
export function codegenTool(ctx: ToolContext, path: string, lang = "curl", env?: string) {
  if (!codegenTargetIds().includes(lang)) {
    return { error: `Unknown lang "${lang}"`, targets: CODEGEN_TARGETS.map((t) => ({ id: t.id, label: t.label })) };
  }
  const prepared = prepareRequest(confinePath(ctx.cwd, path), { cwd: ctx.cwd, ...(env ? { env } : {}) });
  const { target, code } = generateCode(prepared.req, lang, {
    folder: prepared.folder,
    vars: prepared.vars,
  });
  return {
    path,
    lang: target.id,
    label: target.label,
    syntax: target.syntax,
    code,
    ...(prepared.missingSecrets.length > 0 ? { unresolvedSecrets: prepared.missingSecrets } : {}),
  };
}

/** The snippet targets `truspec_codegen` accepts, for an agent to choose from. */
export function codegenTargetsTool() {
  return {
    count: CODEGEN_TARGETS.length,
    targets: CODEGEN_TARGETS.map((t) => ({ id: t.id, label: t.label, group: t.group, syntax: t.syntax })),
  };
}
