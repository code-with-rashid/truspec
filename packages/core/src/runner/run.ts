import type { TruSpecFolderConfig, TruSpecRequest } from "../format/types";
import { type AssertionResult, evaluateAssertions, type ResponseView } from "./assertions";
import { evaluateCaptures } from "./capture";
import type { VarValue, Vars } from "./interpolate";
import { resolveRequest } from "./resolve";

export interface RunContext {
  folder?: TruSpecFolderConfig;
  vars?: Vars;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Injectable clock for deterministic durations; defaults to Date.now. */
  now?: () => number;
  timeoutMs?: number;
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
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

/** Execute one request and evaluate its assertions. Never throws — failures land in the result. */
export async function runRequest(req: TruSpecRequest, ctx: RunContext = {}): Promise<RunResult> {
  const doFetch = ctx.fetch ?? globalThis.fetch;
  const now = ctx.now ?? (() => Date.now());
  const eff = resolveRequest(req, { folder: ctx.folder, vars: ctx.vars });
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
  let response: Response;
  try {
    const init: RequestInit = { method: eff.method, headers: eff.headers };
    if (eff.body !== undefined) init.body = eff.body;
    if (ctx.timeoutMs !== undefined) init.signal = AbortSignal.timeout(ctx.timeoutMs);
    response = await doFetch(eff.url, init);
  } catch (e) {
    return { ...head, ok: false, error: `Request failed: ${(e as Error).message}`, assertions: [] };
  }

  const durationMs = now() - start;
  const bodyText = await response.text();
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
  const assertions = evaluateAssertions(req.assertions, view);
  const ok = assertions.every((a) => a.ok);
  const captured = evaluateCaptures(req.capture, view);

  return {
    ...head,
    ok,
    response: { status: response.status, statusText: response.statusText, durationMs, headers, bodyText },
    assertions,
    ...(Object.keys(captured).length > 0 ? { captured } : {}),
  };
}
