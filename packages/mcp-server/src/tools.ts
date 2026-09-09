import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { CODEGEN_TARGETS, codegenTargetIds, generateCode } from "@truspec/core/codegen";
import { collectionDocs } from "@truspec/core/docs";
import { buildJsonSchemas, parse, SCHEMA_VERSION } from "@truspec/core/format";
import {
  contractReport,
  coverageReport,
  driftReport,
  liveDriftReport,
  scaffoldFromSpec as coreScaffold,
  writeScaffold,
} from "@truspec/core/spec";
import { importCurl, importHarFile, importInsomniaFile, writeImport } from "@truspec/core/importers";
import { lintWorkspace } from "@truspec/core/lint";
import {
  confinePath,
  diffEnvironments,
  discoverRequests,
  listEnvironments,
  prepareRequest,
  runPath,
} from "@truspec/core/workspace";

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

/**
 * Read one request: the parsed object *and* the raw YAML.
 *
 * `truspec_update_request` merges its patch one level deep, so patching `headers` replaces the
 * whole map rather than adding to it. Without a way to read a request first, an agent could only
 * patch safely by already knowing every field it wasn't changing — which is to say, not safely.
 */
export function readRequest(ctx: ToolContext, path: string) {
  const abs = confinePath(ctx.cwd, path);
  if (!existsSync(abs)) return { ok: false as const, error: `Not found: ${path}` };
  const raw = readFileSync(abs, "utf8");
  const result = parse.request.safeParse(raw);
  if (!result.ok || !result.data) return { ok: false as const, path: relative(ctx.cwd, abs), error: result.error, raw };
  return { ok: true as const, path: relative(ctx.cwd, abs), request: result.data, raw };
}

/**
 * Check a request object against the schema without writing anything.
 *
 * The errors name the key a typo was probably meant to be, so a failed validation is a correction
 * rather than a rejection — which is the difference between an agent converging and an agent
 * guessing again.
 */
export function validateRequest(request: unknown) {
  const result = parse.request.validate(request);
  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
}

export function deleteRequest(ctx: ToolContext, path: string) {
  const abs = confinePath(ctx.cwd, path);
  if (!existsSync(abs)) return { ok: false as const, error: `Not found: ${path}` };
  // Only ever a request file: an agent that mistypes a path must not be able to remove a spec, an
  // environment, or anything else that happens to sit in the workspace.
  if (!abs.endsWith(".tspec.yaml")) {
    return { ok: false as const, error: `Refusing to delete a file that is not a .tspec.yaml request: ${path}` };
  }
  rmSync(abs);
  return { ok: true as const, path: relative(ctx.cwd, abs) };
}

/**
 * The published JSON Schema for a file kind, so an agent connecting to this server can learn the
 * format from the server rather than from whatever it remembers about it.
 */
export function formatReference(kind: "request" | "folder" | "environment" = "request") {
  // Generated from the Zod schema that actually validates, not read off disk: a reference that can
  // drift from the validator is worse than none, and the package layout differs between a source
  // checkout and an install.
  return { kind, version: SCHEMA_VERSION, schema: buildJsonSchemas()[`${kind}.schema.json`] };
}

export function createRequest(ctx: ToolContext, path: string, request: unknown) {
  const validation = parse.request.validate(request);
  if (!validation.ok || !validation.data) return { ok: false as const, error: validation.error };
  const abs = confinePath(ctx.cwd, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, parse.request.serialize(validation.data));
  return { ok: true as const, path: relative(ctx.cwd, abs) };
}

/**
 * Merge a patch into a request, one level deep.
 *
 * `null` removes a key — otherwise there is no way to clear an optional field through a merge, and
 * an agent that wanted to drop `auth` would have to delete and recreate the file.
 */
export function updateRequest(ctx: ToolContext, path: string, patch: Record<string, unknown>) {
  const abs = confinePath(ctx.cwd, path);
  if (!existsSync(abs)) return { ok: false as const, error: `Not found: ${path}` };
  const current = parse.request.parse(readFileSync(abs, "utf8"));
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  const validation = parse.request.validate(merged);
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

/**
 * Convert a pasted `curl` command into request file(s). Agents are handed curl commands
 * constantly (docs, devtools, bug reports); this turns one into a first-class, runnable,
 * spec-linkable request instead of a shell one-liner.
 */
export function importCurlTool(ctx: ToolContext, command: string, outDir = ".", name?: string) {
  const result = importCurl(command, name ? { name } : {});
  if (result.files.length === 0) {
    return { created: 0, warnings: result.warnings.length > 0 ? result.warnings : ["No curl command found"] };
  }
  const written = writeImport(result, confinePath(ctx.cwd, outDir));
  return {
    created: written.length,
    files: written.map((f) => relative(ctx.cwd, f)),
    ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
  };
}

/**
 * Static checks over a collection. An agent that writes request files needs to know whether what
 * it just wrote is sound *before* it runs anything — and the machine-readable rule ids let it fix
 * a finding rather than paraphrase it.
 */
export function lintTool(ctx: ToolContext, dir = ".", disable?: string[]) {
  const report = lintWorkspace(confinePath(ctx.cwd, dir), disable ? { disable } : {});
  return { ...report, dir: relative(ctx.cwd, report.dir) || "." };
}

/**
 * Convert a HAR export into request files. A HAR is the highest-fidelity record of what an app
 * actually did, which makes it the fastest path from "reproduce this bug" to a committed
 * regression test — but only if the import strips the browser noise, which it does.
 */
export function importHarTool(
  ctx: ToolContext,
  path: string,
  outDir = ".",
  filter?: string,
  baseUrlVar?: string,
) {
  const result = importHarFile(confinePath(ctx.cwd, path), {
    ...(filter ? { filter } : {}),
    ...(baseUrlVar ? { baseUrlVar } : {}),
  });
  if (result.files.length === 0) return { created: 0, warnings: result.warnings };
  const written = writeImport(result, confinePath(ctx.cwd, outDir));
  return {
    created: written.length,
    files: written.map((f) => relative(ctx.cwd, f)),
    ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
  };
}

/**
 * Render a collection as Markdown. Deterministic by design, so an agent asked to "document the
 * API" produces something that can be committed and re-generated without churning the diff.
 */
export function docsTool(ctx: ToolContext, dir = ".", lang = "curl", title?: string) {
  const result = collectionDocs(confinePath(ctx.cwd, dir), { lang, ...(title ? { title } : {}) });
  return {
    dir,
    count: result.count,
    markdown: result.markdown,
    ...(result.errors.length > 0 ? { errors: result.errors } : {}),
  };
}

/** Convert an Insomnia export into request files. */
export function importInsomniaTool(ctx: ToolContext, path: string, outDir = ".") {
  const result = importInsomniaFile(confinePath(ctx.cwd, path));
  if (result.files.length === 0) return { created: 0, warnings: result.warnings };
  const written = writeImport(result, confinePath(ctx.cwd, outDir));
  return {
    created: written.length,
    files: written.map((f) => relative(ctx.cwd, f)),
    ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
  };
}

/**
 * Describe the workspace's environments, or diff two of them.
 *
 * Secret **values are never returned** — only whether each resolves. An agent debugging a failing
 * run needs to know that `token` is unset; handing it the token would be a different problem.
 */
export function environmentsTool(ctx: ToolContext, dir = ".", diff?: [string, string]) {
  const report = listEnvironments(confinePath(ctx.cwd, dir));
  if (!diff) return { ...report, root: relative(ctx.cwd, report.root) || "." };
  const [aName, bName] = diff;
  const a = report.environments.find((e) => e.name === aName);
  const b = report.environments.find((e) => e.name === bName);
  if (!a || !b) {
    return { error: `Environment not found: ${!a ? aName : bName}`, known: report.environments.map((e) => e.name) };
  }
  return diffEnvironments(a, b);
}
