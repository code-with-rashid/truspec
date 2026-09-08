import type { TruSpecFolderConfig, TruSpecRequest } from "../format/types";
import type { SpecOperation } from "../spec/openapi";
import {
  type AssertionResult,
  type ContractContext,
  evaluateAssertions,
  evaluateSchemaAssertion,
  type ResponseView,
} from "./assertions";
import { evaluateCaptures } from "./capture";
import type { VarValue, Vars } from "./interpolate";
import { type OAuth2Auth, resolveOAuthToken, type TokenCache } from "./oauth";
import { resolveRequest } from "./resolve";
import { runPostScript, runPreScript } from "./script";
import { send } from "./transport";

export interface RunContext {
  folder?: TruSpecFolderConfig;
  vars?: Vars;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Injectable clock for deterministic durations; defaults to Date.now. */
  now?: () => number;
  timeoutMs?: number;
  /** Cap on the response body in bytes; the request fails if a server exceeds it. */
  maxResponseBytes?: number;
  /** Shared OAuth2 token cache, so one collection run hits the token endpoint once. */
  tokenCache?: TokenCache;
  /** Injectable retry backoff, so tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** OpenAPI context for response-schema validation (set when running with a spec). */
  contract?: {
    doc: Record<string, unknown>;
    operation: SpecOperation;
    /** Auto-add an implicit response-schema check for this request (set by `run --spec`). */
    auto?: boolean;
  };
}

export interface RunResult {
  name: string;
  request: { method: string; url: string };
  filePath?: string;
  ok: boolean;
  error?: string;
  missingVars?: string[];
  response?: {
    status: number;
    statusText: string;
    durationMs: number;
    headers: Record<string, string>;
    bodyText: string;
  };
  assertions: AssertionResult[];
  captured?: Record<string, VarValue>;
  /** Redirect hops actually followed, when `options.followRedirects` is on. */
  redirects?: string[];
  /** How many times the request had to be re-sent, when `options.retries` is set. */
  retries?: number;
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

/** Generous default ceiling on a response body so a hostile/buggy server can't OOM the runner. */
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

class ResponseTooLargeError extends Error {}

/**
 * Read a response body as text, but stop and throw once `maxBytes` is exceeded
 * (streaming, so we never buffer an unbounded body into memory). Falls back to
 * `response.text()` when the body isn't a readable stream (empty/HEAD responses).
 */
async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return response.text();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ResponseTooLargeError(`Response body exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const buf = Buffer.allocUnsafe(size);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return buf.toString("utf8");
}

/** Execute one request and evaluate its assertions. Never throws — failures land in the result. */
export async function runRequest(req: TruSpecRequest, ctx: RunContext = {}): Promise<RunResult> {
  const doFetch = ctx.fetch ?? globalThis.fetch;
  const now = ctx.now ?? (() => Date.now());

  // Pre-request script runs first; the vars it sets feed the request's interpolation.
  let vars: Vars = ctx.vars ?? {};
  if (req.script?.pre) {
    const pre = runPreScript(req.script.pre, vars);
    if (pre.error) {
      return {
        name: req.name,
        request: { method: req.method, url: req.url },
        ok: false,
        error: `Pre-request script error: ${pre.error}`,
        assertions: [],
      };
    }
    vars = { ...vars, ...pre.vars };
  }

  // OAuth2 needs a network round-trip before the request can be resolved, so it happens here
  // rather than inside the (synchronous) resolver, which then sees a plain bearer credential.
  const declaredAuth = req.auth ?? ctx.folder?.auth;
  let authOverride: TruSpecRequest["auth"];
  if (declaredAuth?.type === "oauth2") {
    const token = await resolveOAuthToken(declaredAuth as OAuth2Auth, {
      vars,
      fetch: ctx.fetch,
      now: ctx.now,
      cache: ctx.tokenCache,
      timeoutMs: ctx.timeoutMs,
    });
    if (!token.ok) {
      return {
        name: req.name,
        request: { method: req.method, url: req.url },
        ok: false,
        error: token.error,
        assertions: [],
      };
    }
    // Hand the acquired credential back as an opaque bearer-style value. `scheme` is already
    // baked into `token.header`, so the resolver must not prepend "Bearer " a second time.
    authOverride = { type: "apikey", name: "Authorization", value: token.header, in: "header" };
  }

  let eff: ReturnType<typeof resolveRequest>;
  try {
    eff = resolveRequest(req, { folder: ctx.folder, vars, ...(authOverride ? { auth: authOverride } : {}) });
  } catch (e) {
    return {
      name: req.name,
      request: { method: req.method, url: req.url },
      ok: false,
      error: `Could not resolve request: ${(e as Error).message}`,
      assertions: [],
    };
  }
  const head = { name: req.name, request: { method: eff.method, url: eff.url } };

  if (eff.missing.length > 0) {
    return {
      ...head,
      ok: false,
      error: `Unresolved variables: ${eff.missing.map((v) => `{{${v}}}`).join(", ")}`,
      missingVars: eff.missing,
      assertions: [],
    };
  }

  const start = now();
  let sent: Awaited<ReturnType<typeof send>>;
  try {
    sent = await send(
      eff.url,
      { method: eff.method, headers: eff.headers, ...(eff.body !== undefined ? { body: eff.body } : {}) },
      {
        fetch: doFetch,
        timeoutMs: ctx.timeoutMs,
        options: req.options,
        ...(ctx.sleep ? { sleep: ctx.sleep } : {}),
      },
    );
  } catch (e) {
    return { ...head, ok: false, error: `Request failed: ${(e as Error).message}`, assertions: [] };
  }
  const response = sent.response;

  const durationMs = now() - start;
  let bodyText: string;
  try {
    bodyText = await readResponseText(response, ctx.maxResponseBytes ?? MAX_RESPONSE_BYTES);
  } catch (e) {
    return { ...head, ok: false, error: `Request failed: ${(e as Error).message}`, assertions: [] };
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  let json: unknown;
  const contentType = headers["content-type"] ?? "";
  if (contentType.includes("json") || looksLikeJson(bodyText)) {
    try {
      json = JSON.parse(bodyText);
    } catch {
      // non-JSON body; leave json undefined
    }
  }

  const view: ResponseView = { status: response.status, headers, bodyText, json, durationMs };
  const contractCtx: ContractContext | undefined = ctx.contract
    ? { doc: ctx.contract.doc, operation: ctx.contract.operation }
    : undefined;
  const assertions = evaluateAssertions(req.assertions, view, contractCtx);
  // `run --spec` validates every spec-linked request even without an explicit `{ type: schema }`.
  if (ctx.contract?.auto && !req.assertions.some((a) => a.type === "schema")) {
    assertions.push(evaluateSchemaAssertion({ type: "schema" }, view, contractCtx));
  }
  const captured = evaluateCaptures(req.capture, view);

  let scriptError: string | undefined;
  if (req.script?.post) {
    const scripted = runPostScript(req.script.post, view, { ...vars, ...captured });
    assertions.push(...scripted.assertions);
    Object.assign(captured, scripted.captured);
    scriptError = scripted.error;
  }

  const ok = assertions.every((a) => a.ok) && scriptError === undefined;

  return {
    ...head,
    ok,
    ...(sent.redirects.length > 0 ? { redirects: sent.redirects } : {}),
    ...(sent.attempts > 0 ? { retries: sent.attempts } : {}),
    response: { status: response.status, statusText: response.statusText, durationMs, headers, bodyText },
    assertions,
    ...(scriptError ? { error: `Script error: ${scriptError}` } : {}),
    ...(Object.keys(captured).length > 0 ? { captured } : {}),
  };
}
