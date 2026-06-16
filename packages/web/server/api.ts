import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parse } from "@truspec/core/format";
import { coverageReport, driftReport } from "@truspec/core/spec";
import { confinePath, discoverRequests, runPath, walkDirSafe } from "@truspec/core/workspace";

export interface ApiContext {
  dir: string;
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
  const requests = discoverRequests(ctx.dir).map((file) => {
    const req = parse.request.parse(readFileSync(file, "utf8"));
    return {
      path: relative(ctx.dir, file),
      name: req.name,
      method: req.method,
      url: req.url,
      operation: req.spec?.operationId ?? req.spec?.operation,
      assertions: req.assertions.length,
    };
  });
  return {
    dir: ctx.dir,
    requests,
    environments: listEnvironments(ctx.dir),
    specs: listSpecs(ctx.dir),
  };
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
  if (method === "POST" && pathname === "/api/run") {
    const b = (body ?? {}) as { target?: string; env?: string };
    const target = b.target ? confinePath(ctx.dir, b.target) : ctx.dir;
    return { status: 200, json: await runPath(target, { env: b.env || undefined, cwd: ctx.dir }) };
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
  return { status: 404, json: { error: "not found" } };
}
