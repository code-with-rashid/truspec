import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "../format";
import { type RunResult, runRequest, type Vars } from "../runner";
import { buildVars, loadDotenv, loadEnvironment, loadFolderChain } from "./context";
import { discoverRequests, findUp } from "./discover";

/** Default per-request timeout so a stuck server can't hang a run forever. Pass `timeoutMs: 0` to disable. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Replace declared-secret values with `***` wherever they surface in a reported result — most
 * importantly the URL of an `apikey: { in: query }` request, but also an echoed header/body or a
 * captured value — so `truspec run --json` and CI logs don't leak the secret. Short values
 * (< 6 chars) are skipped to avoid masking ubiquitous substrings.
 */
function redactSecrets(result: RunResult, secrets: string[]): void {
  if (secrets.length === 0) return;
  const mask = (s: string): string => {
    let out = s;
    for (const sec of secrets) out = out.split(sec).join("***");
    return out;
  };
  result.request.url = mask(result.request.url);
  if (result.error) result.error = mask(result.error);
  for (const a of result.assertions) a.message = mask(a.message);
  if (result.response) {
    result.response.bodyText = mask(result.response.bodyText);
    for (const [k, v] of Object.entries(result.response.headers)) {
      result.response.headers[k] = mask(v);
    }
  }
  if (result.captured) {
    for (const [k, v] of Object.entries(result.captured)) {
      if (typeof v === "string") result.captured[k] = mask(v);
    }
  }
}

export interface WorkspaceRunOptions {
  env?: string;
  /** Extra variables, applied over the environment's. */
  vars?: Vars;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
  cwd?: string;
  processEnv?: NodeJS.ProcessEnv;
}

export interface WorkspaceRunResult {
  results: RunResult[];
  passed: number;
  failed: number;
  ok: boolean;
  missingSecrets: string[];
}

/** Locate the workspace root by walking up to a dir with `environments/` or `.git`. */
export function findWorkspaceRoot(startDir: string): string {
  return (
    findUp(
      resolve(startDir),
      (d) => existsSync(join(d, "environments")) || existsSync(join(d, ".git")),
    ) ?? resolve(startDir)
  );
}

/** Run a single request file or a directory of requests, returning structured results. */
export async function runPath(target: string, opts: WorkspaceRunOptions = {}): Promise<WorkspaceRunResult> {
  const cwd = opts.cwd ?? process.cwd();
  const abs = resolve(cwd, target);
  if (!existsSync(abs)) throw new Error(`Path not found: ${target}`);

  const isDir = statSync(abs).isDirectory();
  const files = isDir ? discoverRequests(abs) : [abs];
  const startDir = isDir ? abs : dirname(abs);
  const root = findWorkspaceRoot(startDir);

  const env = opts.env ? loadEnvironment(root, opts.env) : undefined;
  if (opts.env && !env) {
    throw new Error(
      `Environment "${opts.env}" not found (looked for environments/${opts.env}.env.yaml)`,
    );
  }
  // A `.env` at the workspace root fills in secrets; real environment variables win.
  const processEnv = { ...loadDotenv(root), ...(opts.processEnv ?? process.env) };
  const built = buildVars(env, processEnv);

  // Parse, then run in `order` (then path) so captured values chain forward.
  const requests = files
    .map((file) => ({ file, req: parse.request.parse(readFileSync(file, "utf8")) }))
    .sort((a, b) => (a.req.order ?? 0) - (b.req.order ?? 0) || a.file.localeCompare(b.file));

  // Resolved values of declared secrets, to scrub from reported output (skip short ones).
  const secretValues = (env?.secrets ?? [])
    .map((name) => built.vars[name])
    .filter((v): v is string => typeof v === "string" && v.length >= 6);

  let vars: Vars = { ...built.vars, ...opts.vars };
  const results: RunResult[] = [];
  for (const { file, req } of requests) {
    const folder = loadFolderChain(dirname(file), root);
    const result = await runRequest(req, {
      folder,
      vars,
      fetch: opts.fetch,
      now: opts.now,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    result.filePath = file;
    results.push(result);
    if (result.captured) vars = { ...vars, ...result.captured }; // chain the real values forward…
    redactSecrets(result, secretValues); // …then mask declared secrets in the reported result
  }

  const passed = results.filter((r) => r.ok).length;
  return {
    results,
    passed,
    failed: results.length - passed,
    ok: results.every((r) => r.ok),
    missingSecrets: built.missingSecrets,
  };
}
