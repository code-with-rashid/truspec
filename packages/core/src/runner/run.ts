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
import { type CookieJar, setCookiesOf } from "./cookies";
import type { VarValue, Vars } from "./interpolate";
import { type OAuth2Auth, resolveOAuthToken, type TokenCache } from "./oauth";
import { type ResolvedPart, resolveRequest } from "./resolve";
import { runPostScript, runPreScript } from "./script";
import { send } from "./transport";
import { describeTransportError } from "./transport-error";

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
  /**
   * Cookie jar shared across a run, so a login response's session cookie is sent by the requests
   * that follow. Omit it to send no cookies at all.
   */
  cookieJar?: CookieJar;
  /** Injectable retry backoff, so tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Reads a file part for a `multipart` body. Supplied by the workspace runner (which confines
   * the path to the collection); absent in a browser/embedded context, where a file part fails
   * with a clear message rather than silently sending nothing.
   */
  readFile?: (path: string) => Promise<{ bytes: Uint8Array; filename: string }>;
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
    /** Size of the body as it arrived, in bytes — not the length of the decoded string. */
    bytes?: number;
    /**
     * The body is not text: it decoded with replacement characters or NUL bytes. `bodyText` is
     * then lossy and must not be shown as if it were the response — a viewer that prints it emits
     * mojibake (and whatever terminal escapes the bytes happen to contain).
     */
    binary?: boolean;
    /**
     * The body's real bytes, base64-encoded, for a binary response small enough to carry
     * ({@link MAX_BINARY_BASE64_BYTES}). Without it a client can only offer to save the mojibake,
     * which produces a file that is not the one the server sent.
     */
    bodyBase64?: string;
  };
  assertions: AssertionResult[];
  captured?: Record<string, VarValue>;
  /** Redirect hops actually followed, when `options.followRedirects` is on. */
  redirects?: string[];
  /** The chain stopped because `maxRedirects` was reached, not because the server stopped redirecting. */
  redirectLimitHit?: boolean;
  /** How many times the request had to be re-sent, when `options.retries` is set. */
  retries?: number;
  /** 1-based iteration this result belongs to, when the run was data-driven or repeated. */
  iteration?: number;
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

/** Generous default ceiling on a response body so a hostile/buggy server can't OOM the runner. */
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

class ResponseTooLargeError extends Error {}

/**
 * The charset the response declares, as a `TextDecoder` label.
 *
 * HTTP's historical default for `text/*` is ISO-8859-1, but in practice a response that omits a
 * charset today means UTF-8, and decoding a modern JSON API as latin-1 would corrupt every
 * non-ASCII byte in it. So: honour an explicit charset, default to UTF-8.
 */
function charsetOf(contentType: string): string {
  return /charset\s*=\s*"?([\w.:+-]+)"?/i.exec(contentType)?.[1]?.toLowerCase() ?? "utf-8";
}

/**
 * Decode a response body the way the response says to.
 *
 * Two things a plain `buf.toString("utf8")` gets wrong. A server that declares
 * `charset=iso-8859-1` (legacy APIs still do) had every accented character replaced with U+FFFD,
 * so `body contains "café"` could not match a body that plainly contained it. And a UTF-8 BOM —
 * emitted by plenty of .NET and PHP stacks — is invisible in every viewer but makes `JSON.parse`
 * throw, which surfaced as *every* jsonpath assertion reporting "(no match)" against a 200 whose
 * body was obviously right. An unknown charset label is not a reason to fail the request; fall
 * back to UTF-8, which is what would have happened anyway.
 */
export function decodeResponseBody(buf: Buffer, contentType: string): string {
  const label = charsetOf(contentType);
  let text: string;
  if (label === "utf-8" || label === "utf8") text = buf.toString("utf8");
  else {
    try {
      text = new TextDecoder(label).decode(buf);
    } catch {
      text = buf.toString("utf8");
    }
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Whether a decoded body is not text after all.
 *
 * Decided on content rather than on the content type: plenty of servers label JSON as
 * `application/octet-stream`, and plenty label a PDF `text/plain`. A replacement character means
 * the bytes were not valid in the declared encoding; a NUL means they were never text.
 */
function looksBinary(text: string): boolean {
  return text.includes("\uFFFD") || text.includes("\u0000");
}

/** Ceiling on a binary body carried along as base64 — past this, only the size is reported. */
export const MAX_BINARY_BASE64_BYTES = 8 * 1024 * 1024;

/**
 * Read a response body as text, but stop and throw once `maxBytes` is exceeded
 * (streaming, so we never buffer an unbounded body into memory). Falls back to
 * buffering the whole response when the body isn't a readable stream (empty/HEAD responses).
 */
interface ReadBody {
  text: string;
  bytes: number;
  binary: boolean;
  base64?: string;
}

/** Package a buffer as the runner's view of a body: decoded text, plus the bytes if it is binary. */
function describeBody(buf: Buffer, contentType: string): ReadBody {
  const text = decodeResponseBody(buf, contentType);
  if (!looksBinary(text)) return { text, bytes: buf.byteLength, binary: false };
  return {
    text,
    bytes: buf.byteLength,
    binary: true,
    ...(buf.byteLength <= MAX_BINARY_BASE64_BYTES ? { base64: buf.toString("base64") } : {}),
  };
}

async function readResponseText(response: Response, maxBytes: number): Promise<ReadBody> {
  const contentType = response.headers.get("content-type") ?? "";
  const body = response.body;
  if (!body) return describeBody(Buffer.from(await response.arrayBuffer()), contentType);
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
  return describeBody(buf, contentType);
}

/**
 * Assemble a `multipart/form-data` body. Text parts become plain fields; a file part is read
 * through the injected reader (the workspace runner confines it to the collection) and sent as a
 * `Blob` so `fetch` generates the boundary and per-part headers itself.
 */
async function buildFormData(
  parts: ResolvedPart[],
  readFile: RunContext["readFile"],
): Promise<FormData> {
  const form = new FormData();
  for (const part of parts) {
    if (part.kind === "text") {
      if (part.contentType || part.filename) {
        // A typed text part needs to travel as a Blob for its Content-Type to survive.
        form.append(
          part.name,
          new Blob([part.value], { type: part.contentType ?? "text/plain" }),
          part.filename ?? part.name,
        );
      } else {
        form.append(part.name, part.value);
      }
      continue;
    }
    if (!readFile) {
      throw new Error(
        `field "${part.name}" reads ${part.path}, but this runner has no filesystem access`,
      );
    }
    const { bytes, filename } = await readFile(part.path);
    // Copy into a plain ArrayBuffer: a Uint8Array over a SharedArrayBuffer is not a valid
    // BlobPart under the DOM lib the web package typechecks against.
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    form.append(
      part.name,
      new Blob([buffer], part.contentType ? { type: part.contentType } : {}),
      part.filename ?? filename,
    );
  }
  return form;
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

  let multipartBody: FormData | undefined;
  if (eff.multipart) {
    try {
      multipartBody = await buildFormData(eff.multipart, ctx.readFile);
    } catch (e) {
      return { ...head, ok: false, error: `Multipart body: ${(e as Error).message}`, assertions: [] };
    }
  }

  const start = now();
  let sent: Awaited<ReturnType<typeof send>>;
  try {
    sent = await send(
      eff.url,
      {
        method: eff.method,
        headers: eff.headers,
        ...(multipartBody !== undefined
          ? { body: multipartBody }
          : eff.body !== undefined
            ? { body: eff.body }
            : {}),
      },
      {
        fetch: doFetch,
        timeoutMs: ctx.timeoutMs,
        options: req.options,
        ...(ctx.sleep ? { sleep: ctx.sleep } : {}),
        ...(ctx.cookieJar
          ? {
              cookieHeaderFor: (u: string) => ctx.cookieJar?.headerFor(u, now()),
              // Store from every hop: a login that 302s sets its session cookie on the redirect,
              // not on the page you land on.
              onResponse: (u: string, r: Response) => ctx.cookieJar?.setFromResponse(u, setCookiesOf(r), now()),
            }
          : {}),
      },
    );
  } catch (e) {
    return { ...head, ok: false, error: describeTransportError(e, eff.url), assertions: [] };
  }
  const response = sent.response;

  const durationMs = now() - start;
  let body: ReadBody;
  try {
    body = await readResponseText(response, ctx.maxResponseBytes ?? MAX_RESPONSE_BYTES);
  } catch (e) {
    // The response started arriving and then stopped; name the same causes the send path does.
    return { ...head, ok: false, error: describeTransportError(e, eff.url), assertions: [] };
  }
  const bodyText = body.text;
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
    ...(sent.redirectLimitHit ? { redirectLimitHit: true } : {}),
    ...(sent.attempts > 0 ? { retries: sent.attempts } : {}),
    response: {
      status: response.status,
      statusText: response.statusText,
      durationMs,
      headers,
      bodyText,
      bytes: body.bytes,
      ...(body.binary ? { binary: true } : {}),
      ...(body.base64 !== undefined ? { bodyBase64: body.base64 } : {}),
    },
    assertions,
    ...(scriptError ? { error: `Script error: ${scriptError}` } : {}),
    ...(Object.keys(captured).length > 0 ? { captured } : {}),
  };
}
