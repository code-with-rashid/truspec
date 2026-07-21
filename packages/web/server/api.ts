import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parse } from "@truspec/core/format";
import { importBrunoFiles, importPostman, type ImportedFile, type ImportResult } from "@truspec/core/importers";
import { type MockRequestLogEntry, type MockServerHandle, startMockServer } from "@truspec/core/mock";
import { resolveRequest } from "@truspec/core/runner";
import { coverageReport, driftReport } from "@truspec/core/spec";
import {
  confinePath,
  discoverRequests,
  findWorkspaceRoot,
  loadFolderChain,
  runPath,
  walkDirSafe,
} from "@truspec/core/workspace";

/** Default mock server port, matching `truspec mock`'s CLI default. */
const DEFAULT_MOCK_PORT = 4000;
/** Ring buffer cap for the in-UI mock request log. */
const MOCK_LOG_LIMIT = 50;

interface MockState {
  handle: MockServerHandle;
  spec: string;
  log: Array<MockRequestLogEntry & { at: number }>;
}

export interface ApiContext {
  dir: string;
  /** Mutable: set while a mock server started from the UI is running. */
  mock?: MockState;
}

interface MockStatusJson {
  running: boolean;
  spec?: string;
  port?: number;
  url?: string;
  routes?: number;
}

function mockStatusJson(ctx: ApiContext): MockStatusJson {
  return {
    running: !!ctx.mock,
    spec: ctx.mock?.spec,
    port: ctx.mock?.handle.port,
    url: ctx.mock?.handle.url,
    routes: ctx.mock?.handle.routes,
  };
}

export interface ApiResult {
  status: number;
  json: unknown;
}

function listEnvironments(dir: string): string[] {
  const envDir = join(dir, "environments");
  if (!existsSync(envDir)) return [];
  return readdirSync(envDir)
    .filter((f) => f.endsWith(".env.yaml"))
    .map((f) => f.replace(/\.env\.yaml$/, ""))
    .sort();
}

function listSpecs(dir: string): string[] {
  const out: string[] = [];
  walkDirSafe(
    dir,
    (full, name) => {
      if (!/\.(ya?ml|json)$/.test(name) || name.endsWith(".tspec.yaml")) return;
      try {
        const text = readFileSync(full, "utf8");
        if (name.includes("openapi") || /["']?openapi["']?\s*:/.test(text)) out.push(relative(dir, full));
      } catch {
        // ignore unreadable files
      }
    },
    { skip: ["environments"] },
  );
  return out;
}

function buildState(ctx: ApiContext) {
  // A single malformed `.tspec.yaml` must not make the whole workspace fail to load (a 500 on
  // /api/state would white-screen the UI with no way to find the broken file). List the valid
  // requests and surface bad files (with their path) as errors instead of throwing.
  const requests: Array<Record<string, unknown>> = [];
  const errors: Array<{ path: string; error: string }> = [];
  for (const file of discoverRequests(ctx.dir)) {
    const path = relative(ctx.dir, file);
    try {
      const req = parse.request.parse(readFileSync(file, "utf8"));
      requests.push({
        path,
        name: req.name,
        method: req.method,
        url: req.url,
        // Same priority `driftReport` uses to build its `removed` refs (operation ?? operationId ?? name)
        // so the UI can match a request against drift output without a second round-trip.
        specRef: req.spec ? (req.spec.operation ?? req.spec.operationId ?? req.name) : undefined,
        assertions: req.assertions.length,
      });
    } catch (e) {
      errors.push({ path, error: (e as Error).message });
    }
  }
  return {
    dir: ctx.dir,
    requests,
    errors,
    environments: listEnvironments(ctx.dir),
    specs: listSpecs(ctx.dir),
  };
}

/**
 * Ordered flow steps for the Flow view: each step's `capture` names, plus its `consumes`
 * names — the `{{var}}` references it needs resolved — computed by resolving the request
 * against an *empty* var map and reading `EffectiveRequest.missing`, exactly the set of names
 * `runPath` would need chained in from an earlier step (or an environment) to actually run.
 * No separate "which vars does this reference" extractor needed; this is the real resolver.
 */
function buildFlow(ctx: ApiContext) {
  const root = findWorkspaceRoot(ctx.dir);
  const steps: Array<Record<string, unknown>> = [];
  const errors: Array<{ path: string; error: string }> = [];
  const parsed: Array<{ file: string; path: string; req: ReturnType<typeof parse.request.parse> }> = [];
  for (const file of discoverRequests(ctx.dir)) {
    const path = relative(ctx.dir, file);
    try {
      parsed.push({ file, path, req: parse.request.parse(readFileSync(file, "utf8")) });
    } catch (e) {
      errors.push({ path, error: (e as Error).message });
    }
  }
  // Same ordering `runPath` uses to chain captures forward, so the list IS the run order.
  parsed.sort((a, b) => (a.req.order ?? 0) - (b.req.order ?? 0) || a.file.localeCompare(b.file));
  for (const { file, path, req } of parsed) {
    const folder = loadFolderChain(dirname(file), root);
    let consumes: string[] = [];
    try {
      consumes = resolveRequest(req, { folder, vars: {} }).missing;
    } catch {
      // A pathologically nested body would throw here; drop consumes rather than failing the
      // whole flow view over one request the runner itself would also refuse to send.
    }
    steps.push({
      path,
      name: req.name,
      method: req.method,
      url: req.url,
      order: req.order ?? 0,
      docs: req.docs,
      assertions: req.assertions.length,
      captures: Object.keys(req.capture ?? {}),
      consumes,
      specRef: req.spec ? (req.spec.operation ?? req.spec.operationId ?? req.name) : undefined,
    });
  }
  return { dir: ctx.dir, steps, errors };
}

/**
 * Write an import result under `targetDir`, confining every file's path first (rejecting the
 * whole import atomically if any escapes) — unlike core's `writeImport`, which trusts its
 * caller. Bruno import paths here originate from a browser file picker, i.e. client-supplied
 * strings, so `../../etc/whatever.bru` must not reach disk outside the workspace.
 */
function writeImportConfined(result: ImportResult, targetDir: string): string[] {
  // `confinePath` resolves its *root* with `realpathSync` unconditionally (only the target side
  // tolerates not-yet-existing paths), so a brand-new target directory must exist before it's
  // usable as that root.
  mkdirSync(targetDir, { recursive: true });
  const targets = result.files.map((f) => ({ abs: confinePath(targetDir, f.path), content: f.content }));
  for (const t of targets) {
    mkdirSync(dirname(t.abs), { recursive: true });
    writeFileSync(t.abs, t.content);
  }
  return targets.map((t) => relative(targetDir, t.abs));
}

export async function handleApi(
  method: string,
  pathname: string,
  query: URLSearchParams,
  body: unknown,
  ctx: ApiContext,
): Promise<ApiResult> {
  if (method === "GET" && pathname === "/api/state") {
    return { status: 200, json: buildState(ctx) };
  }
  if (method === "GET" && pathname === "/api/flow") {
    return { status: 200, json: buildFlow(ctx) };
  }
  if (method === "GET" && pathname === "/api/request") {
    const p = query.get("path");
    if (!p) return { status: 400, json: { error: "path required" } };
    const text = readFileSync(confinePath(ctx.dir, p), "utf8");
    // Parsed fields for display + the raw source so the editor round-trips exactly.
    return { status: 200, json: { ...parse.request.parse(text), raw: text } };
  }
  if (method === "POST" && pathname === "/api/request") {
    const b = (body ?? {}) as { path?: string; content?: string };
    if (!b.path || typeof b.content !== "string") {
      return { status: 400, json: { error: "path and content required" } };
    }
    if (!b.path.endsWith(".tspec.yaml") || b.path.endsWith("folder.tspec.yaml")) {
      return { status: 200, json: { ok: false, error: "Path must be a request file ending in .tspec.yaml" } };
    }
    const validation = parse.request.safeParse(b.content);
    if (!validation.ok) return { status: 200, json: { ok: false, error: validation.error } };
    let abs: string;
    try {
      abs = confinePath(ctx.dir, b.path);
    } catch (e) {
      return { status: 200, json: { ok: false, error: (e as Error).message } };
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, b.content);
    return { status: 200, json: { ok: true, path: relative(ctx.dir, abs) } };
  }
  if (method === "POST" && pathname === "/api/import/postman") {
    const b = (body ?? {}) as { json?: unknown; targetDir?: string };
    if (b.json === undefined) return { status: 400, json: { error: "json required" } };
    let target: string;
    try {
      target = b.targetDir ? confinePath(ctx.dir, b.targetDir) : ctx.dir;
    } catch (e) {
      return { status: 200, json: { ok: false, error: (e as Error).message } };
    }
    let result: ImportResult;
    try {
      result = importPostman(b.json);
    } catch (e) {
      return { status: 200, json: { ok: false, error: (e as Error).message } };
    }
    try {
      const written = writeImportConfined(result, target);
      return { status: 200, json: { ok: true, stats: result.stats, warnings: result.warnings, files: written } };
    } catch (e) {
      return { status: 200, json: { ok: false, error: (e as Error).message } };
    }
  }
  if (method === "POST" && pathname === "/api/import/bruno") {
    const b = (body ?? {}) as { files?: Array<{ path?: string; content?: string }>; targetDir?: string };
    if (!Array.isArray(b.files) || b.files.length === 0) {
      return { status: 400, json: { error: "files required" } };
    }
    const files: ImportedFile[] = [];
    for (const f of b.files) {
      if (typeof f.path !== "string" || typeof f.content !== "string") {
        return { status: 400, json: { error: "each file needs a path and content" } };
      }
      files.push({ path: f.path, content: f.content });
    }
    let target: string;
    try {
      target = b.targetDir ? confinePath(ctx.dir, b.targetDir) : ctx.dir;
    } catch (e) {
      return { status: 200, json: { ok: false, error: (e as Error).message } };
    }
    const result = importBrunoFiles(files);
    try {
      const written = writeImportConfined(result, target);
      return { status: 200, json: { ok: true, stats: result.stats, warnings: result.warnings, files: written } };
    } catch (e) {
      return { status: 200, json: { ok: false, error: (e as Error).message } };
    }
  }
  if (method === "POST" && pathname === "/api/run") {
    const b = (body ?? {}) as { target?: string; env?: string; spec?: string };
    const target = b.target ? confinePath(ctx.dir, b.target) : ctx.dir;
    // Mirrors `truspec run --spec`: every spec-linked request gets its response validated
    // against the OpenAPI operation, even without an explicit `{ type: schema }` assertion.
    return {
      status: 200,
      json: await runPath(target, { env: b.env || undefined, cwd: ctx.dir, spec: b.spec || undefined }),
    };
  }
  if (method === "POST" && pathname === "/api/drift") {
    const b = (body ?? {}) as { spec?: string };
    if (!b.spec) return { status: 400, json: { error: "spec required" } };
    return { status: 200, json: driftReport(ctx.dir, confinePath(ctx.dir, b.spec)) };
  }
  if (method === "POST" && pathname === "/api/coverage") {
    const b = (body ?? {}) as { spec?: string };
    if (!b.spec) return { status: 400, json: { error: "spec required" } };
    return { status: 200, json: coverageReport(ctx.dir, confinePath(ctx.dir, b.spec)) };
  }
  if (method === "GET" && pathname === "/api/mock/status") {
    return { status: 200, json: mockStatusJson(ctx) };
  }
  if (method === "POST" && pathname === "/api/mock/start") {
    const b = (body ?? {}) as { spec?: string; port?: number };
    if (!b.spec) return { status: 400, json: { error: "spec required" } };
    let specPath: string;
    try {
      specPath = confinePath(ctx.dir, b.spec);
    } catch (e) {
      return { status: 200, json: { ok: false, error: (e as Error).message } };
    }
    if (ctx.mock) await ctx.mock.handle.close(); // restart on a new spec/port
    let specText: string;
    try {
      specText = readFileSync(specPath, "utf8");
    } catch (e) {
      ctx.mock = undefined;
      return { status: 200, json: { ok: false, error: (e as Error).message } };
    }
    const log: MockState["log"] = [];
    try {
      const handle = await startMockServer(specText, {
        port: b.port ?? DEFAULT_MOCK_PORT,
        validate: true,
        onRequest: (entry) => {
          log.unshift({ ...entry, at: Date.now() });
          log.length = Math.min(log.length, MOCK_LOG_LIMIT);
        },
      });
      ctx.mock = { handle, spec: b.spec, log };
    } catch (e) {
      ctx.mock = undefined;
      return { status: 200, json: { ok: false, error: (e as Error).message } };
    }
    return { status: 200, json: { ok: true, ...mockStatusJson(ctx) } };
  }
  if (method === "POST" && pathname === "/api/mock/stop") {
    if (ctx.mock) {
      await ctx.mock.handle.close();
      ctx.mock = undefined;
    }
    return { status: 200, json: { ok: true } };
  }
  if (method === "GET" && pathname === "/api/mock/log") {
    return { status: 200, json: { log: ctx.mock?.log ?? [] } };
  }
  return { status: 404, json: { error: "not found" } };
}
