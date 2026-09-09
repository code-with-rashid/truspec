import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { dirname, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parse } from "../format";
import type { TruSpecRequest } from "../format/types";
import { CookieJar, type RunResult, runRequest, type TokenCache, type Vars } from "../runner";
import { refMatchesOp } from "../spec/drift";
import { parseOpenApi, type SpecOperation } from "../spec/openapi";
import { confinePath } from "./confine";
import { type DataRow, parseDataText } from "./data";
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
    for (const sec of secrets) {
      out = out.split(sec).join("***");
      // A secret in a query param is percent-encoded by URLSearchParams (base64 tokens
      // contain +/=), so scrub the encoded form too or it would slip through in the URL.
      const enc = encodeURIComponent(sec);
      if (enc !== sec) out = out.split(enc).join("***");
    }
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
  /** OpenAPI spec path: spec-linked requests get their response validated against it. */
  spec?: string;
  /** Only run requests whose name or workspace-relative path matches this regular expression. */
  grep?: string;
  /** Only run requests carrying at least one of these `tags`. */
  tags?: string[];
  /** Stop the run at the first failing request; the rest are reported as skipped. */
  bail?: boolean;
  /** Pause between requests, for rate-limited APIs. */
  delayMs?: number;
  /** Wait between requests; injectable so tests don't actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Set to false to send no cookies at all. Default: a jar shared across the run. */
  cookies?: boolean;
  /**
   * Dataset path (CSV or JSON). The selection runs once per row, with the row's columns as
   * variables — the data-driven runs `newman -d` and Bruno's runner provide.
   */
  data?: string;
  /** Run the selection this many times. Ignored when `data` is set (the dataset decides). */
  repeat?: number;
}

export interface WorkspaceRunResult {
  results: RunResult[];
  /** How many times the selection was executed (1 unless `data`/`repeat` was used). */
  iterations?: number;
  passed: number;
  failed: number;
  /** Requests that were selected but never sent, because `bail` stopped the run first. */
  skipped: number;
  ok: boolean;
  missingSecrets: string[];
  /** Requests filtered out by `grep`/`tags` before the run started. */
  deselected?: number;
  /**
   * Files that did not parse, with their absolute path.
   *
   * A single typo used to abort the whole run with a message that named no file. The other
   * requests still run; the run is still `ok: false`, because a request that could not even be
   * read is not a request that passed.
   */
  parseErrors?: Array<{ file: string; error: string }>;
}

/** Load the dataset a data-driven run iterates over, or `undefined` for a single pass. */
function loadDataRows(opts: WorkspaceRunOptions, cwd: string): DataRow[] | undefined {
  if (!opts.data) return undefined;
  const abs = resolve(cwd, opts.data);
  if (!existsSync(abs)) throw new Error(`Data file not found: ${opts.data}`);
  const rows = parseDataText(readFileSync(abs, "utf8"), abs);
  // An empty dataset must not quietly become "one run with no variables" — that would report a
  // pass for a gate that never exercised the data it was given.
  if (rows.length === 0) throw new Error(`Data file has no rows: ${opts.data}`);
  return rows;
}

/**
 * Reader for a `multipart` file part: paths resolve relative to the request file (what an author
 * expects) and are **confined to the workspace root**, so a collection — which may have been
 * imported, generated, or written by an agent — cannot read `../../.ssh/id_rsa` and POST it.
 */
function makeFileReader(
  requestDir: string,
  root: string,
): (path: string) => Promise<{ bytes: Uint8Array; filename: string }> {
  return async (path: string) => {
    const abs = confinePath(requestDir, path.startsWith("/") ? path : path);
    // `confinePath` anchors at requestDir; re-check against the workspace root so a relative
    // `../..` escape out of the collection is refused even when it stays on disk.
    const rootAnchored = confinePath(root, relative(root, abs));
    if (!existsSync(rootAnchored)) throw new Error(`file not found: ${path}`);
    return { bytes: new Uint8Array(readFileSync(rootAnchored)), filename: basename(rootAnchored) };
  };
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

  // Optional OpenAPI spec: load operations (for matching) and the raw doc (for $ref resolution).
  let specOps: SpecOperation[] | undefined;
  let specDoc: Record<string, unknown> | undefined;
  if (opts.spec) {
    const specPath = resolve(cwd, opts.spec);
    if (!existsSync(specPath)) throw new Error(`Spec not found: ${opts.spec}`);
    const specText = readFileSync(specPath, "utf8");
    specOps = parseOpenApi(specText).operations;
    specDoc = (parseYaml(specText) as Record<string, unknown>) ?? {};
  }

  // Parse, then run in `order` (then path) so captured values chain forward. One unparseable file
  // must not take the rest of the run with it — and must be reported *by name*, which throwing
  // from inside a `.map` could not do.
  const parseErrors: Array<{ file: string; error: string }> = [];
  const parsed: Array<{ file: string; req: TruSpecRequest }> = [];
  for (const file of files) {
    try {
      parsed.push({ file, req: parse.request.parse(readFileSync(file, "utf8")) });
    } catch (e) {
      parseErrors.push({ file, error: (e as Error).message });
    }
  }
  parsed.sort((a, b) => (a.req.order ?? 0) - (b.req.order ?? 0) || a.file.localeCompare(b.file));
  parseErrors.sort((a, b) => a.file.localeCompare(b.file));

  const selector = buildSelector(opts, root);
  const requests = selector ? parsed.filter(({ file, req }) => selector(req, file)) : parsed;
  const deselected = parsed.length - requests.length;

  // Resolved values of declared secrets, to scrub from reported output (skip short ones).
  const secretValues = (env?.secrets ?? [])
    .map((name) => built.vars[name])
    .filter((v): v is string => typeof v === "string" && v.length >= 6);

  const baseVars: Vars = { ...built.vars, ...opts.vars };
  const results: RunResult[] = [];
  // One cache for the whole run: twenty requests under a folder-level OAuth2 block should fetch
  // one token, not twenty (a real rate-limit hazard, and a real cost on metered providers).
  // It survives across iterations too — the credentials do not change between rows.
  const tokenCache: TokenCache = new Map();
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const dataRows = loadDataRows(opts, cwd);
  const iterations = dataRows ? dataRows.length : Math.max(1, Math.floor(opts.repeat ?? 1));
  let bailed = false;
  let executed = 0;

  for (let iteration = 0; iteration < iterations && !bailed; iteration++) {
    // Each iteration starts from the same variables and a fresh cookie jar: rows must be
    // independent, or row 2 silently inherits row 1's captured ids and session.
    let vars: Vars = { ...baseVars, ...(dataRows?.[iteration] ?? {}) };
    const cookieJar = opts.cookies === false ? undefined : new CookieJar();

    for (const [index, { file, req }] of requests.entries()) {
      if (bailed) break;
      // Rate-limited APIs need breathing room between calls; pause *between* requests only, so a
      // single-request run is never slowed down for nothing.
      if (opts.delayMs && opts.delayMs > 0 && (index > 0 || iteration > 0)) await sleep(opts.delayMs);
      const folder = loadFolderChain(dirname(file), root);
      // Match the request to its spec operation so its response is validated against the contract.
      const op = specOps && req.spec ? specOps.find((o) => refMatchesOp(req.spec!, o)) : undefined;
      const result = await runRequest(req, {
        folder,
        vars,
        fetch: opts.fetch,
        now: opts.now,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        tokenCache,
        ...(cookieJar ? { cookieJar } : {}),
        readFile: makeFileReader(dirname(file), root),
        ...(op && specDoc ? { contract: { doc: specDoc, operation: op, auto: true } } : {}),
      });
      result.filePath = file;
      if (iterations > 1) result.iteration = iteration + 1;
      results.push(result);
      executed += 1;
      if (result.captured) vars = { ...vars, ...result.captured }; // chain the real values forward…
      redactSecrets(result, secretValues); // …then mask declared secrets in the reported result
      if (opts.bail && !result.ok) bailed = true;
    }
  }

  const passed = results.filter((r) => r.ok).length;
  return {
    results,
    ...(iterations > 1 ? { iterations } : {}),
    passed,
    failed: results.length - passed,
    skipped: requests.length * iterations - executed,
    // A file that could not be read is not a file that passed: the run is red either way.
    ok: results.every((r) => r.ok) && parseErrors.length === 0,
    missingSecrets: built.missingSecrets,
    ...(deselected > 0 ? { deselected } : {}),
    ...(parseErrors.length > 0 ? { parseErrors } : {}),
  };
}

/**
 * Build the `--grep` / `--tag` predicate, or `undefined` when nothing was asked for.
 *
 * `grep` matches the request's name *or* its workspace-relative path, because both are things a
 * developer naturally reaches for ("the login one", "everything under billing/"). Tags are OR-ed:
 * `--tag smoke --tag auth` runs anything carrying either.
 */
function buildSelector(
  opts: WorkspaceRunOptions,
  root: string,
): ((req: { name: string; tags?: string[] }, file: string) => boolean) | undefined {
  const wantTags = opts.tags?.filter((t) => t.length > 0) ?? [];
  let re: RegExp | undefined;
  if (opts.grep) {
    try {
      re = new RegExp(opts.grep, "i");
    } catch (e) {
      throw new Error(`Invalid --grep pattern: ${(e as Error).message}`);
    }
  }
  if (!re && wantTags.length === 0) return undefined;
  return (req, file) => {
    if (re && !(re.test(req.name) || re.test(relative(root, file)))) return false;
    if (wantTags.length > 0 && !(req.tags ?? []).some((t) => wantTags.includes(t))) return false;
    return true;
  };
}
