import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parse } from "@truspec/core/format";
import { coverageReport, driftReport } from "@truspec/core/spec";
import { discoverRequests, runPath } from "@truspec/core/workspace";

export interface ApiContext {
  dir: string;
}

export interface ApiResult {
  status: number;
  json: unknown;
}

/** Confine a relative path to the served workspace. */
function within(dir: string, target: string): string {
  const abs = resolve(dir, target);
  if (abs !== dir && !abs.startsWith(dir + sep)) throw new Error("Path escapes the workspace");
  return abs;
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
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      if (name === "node_modules" || name === ".git" || name === "environments") continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ya?ml|json)$/.test(name) && !name.endsWith(".tspec.yaml")) {
        try {
          const text = readFileSync(full, "utf8");
          if (name.includes("openapi") || /["']?openapi["']?\s*:/.test(text)) out.push(relative(dir, full));
        } catch {
          // ignore unreadable files
        }
      }
    }
  };
  walk(dir);
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
    return { status: 200, json: parse.request.parse(readFileSync(within(ctx.dir, p), "utf8")) };
  }
  if (method === "POST" && pathname === "/api/run") {
    const b = (body ?? {}) as { target?: string; env?: string };
    const target = b.target ? within(ctx.dir, b.target) : ctx.dir;
    return { status: 200, json: await runPath(target, { env: b.env || undefined, cwd: ctx.dir }) };
  }
  if (method === "POST" && pathname === "/api/drift") {
    const b = (body ?? {}) as { spec?: string };
    if (!b.spec) return { status: 400, json: { error: "spec required" } };
    return { status: 200, json: driftReport(ctx.dir, within(ctx.dir, b.spec)) };
  }
  if (method === "POST" && pathname === "/api/coverage") {
    const b = (body ?? {}) as { spec?: string };
    if (!b.spec) return { status: 400, json: { error: "spec required" } };
    return { status: 200, json: coverageReport(ctx.dir, within(ctx.dir, b.spec)) };
  }
  return { status: 404, json: { error: "not found" } };
}
