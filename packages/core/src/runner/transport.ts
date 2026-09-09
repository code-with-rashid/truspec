import type { TruSpecRequestOptions } from "../format/types";

export interface SendOptions {
  fetch: typeof globalThis.fetch;
  /** Run-wide timeout; a request's own `options.timeoutMs` overrides it. */
  timeoutMs?: number;
  options?: TruSpecRequestOptions;
  /** Injectable so retry/backoff tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Cookie header to send to a given URL. Called per hop, so a redirect chain gets the cookies
   * that belong to *that* host rather than the ones the first request carried.
   */
  cookieHeaderFor?: (url: string) => string | undefined;
  /** Called with every response, including intermediate redirects, so their cookies are stored. */
  onResponse?: (url: string, response: Response) => void;
}

export interface SendOutcome {
  response: Response;
  /** URLs actually visited after the first, when redirects were followed. */
  redirects: string[];
  /** How many times the request had to be re-sent (0 when it succeeded first try). */
  attempts: number;
}

/** Default pause before the first retry; doubles per attempt. */
const DEFAULT_RETRY_DELAY_MS = 200;
/** Ceiling on the backoff, so `retries: 10` can't turn into a multi-minute stall. */
const MAX_RETRY_DELAY_MS = 5_000;
const DEFAULT_MAX_REDIRECTS = 5;

/** 3xx codes that carry a `Location` a client is meant to follow. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** A transient response worth re-sending: rate limiting, or a server-side fault. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Send one request, applying the per-request transport options: timeout, retry-on-transient, and
 * (opt-in) redirect following.
 *
 * Redirects are followed *manually* rather than by handing `redirect: "follow"` to fetch, because
 * the runner must be able to report which hops happened, and because the platform's own follow
 * would also carry the `Authorization` header to a different origin — a credential leak to
 * whatever host the redirect names.
 */
export async function send(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string | FormData },
  opts: SendOptions,
): Promise<SendOutcome> {
  const o = opts.options ?? {};
  const retries = o.retries ?? 0;
  const baseDelay = o.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) await sleep(Math.min(baseDelay * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS));
    try {
      const outcome = await sendOnce(url, init, opts);
      // The last attempt always returns: a 503 after the final retry is the answer, not an error.
      if (attempt < retries && isRetryableStatus(outcome.response.status)) {
        // Drain the body so the connection can be reused rather than left half-read.
        await outcome.response.arrayBuffer().catch(() => {});
        continue;
      }
      return { ...outcome, attempts: attempt };
    } catch (e) {
      if (attempt >= retries) throw e;
    }
  }
}

async function sendOnce(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string | FormData },
  opts: SendOptions,
): Promise<{ response: Response; redirects: string[] }> {
  const o = opts.options ?? {};
  const timeoutMs = o.timeoutMs ?? opts.timeoutMs;
  const maxRedirects = o.followRedirects ? (o.maxRedirects ?? DEFAULT_MAX_REDIRECTS) : 0;

  const redirects: string[] = [];
  let currentUrl = url;
  let method = init.method;
  let headers = { ...init.headers };
  let body: string | FormData | undefined = init.body;

  for (let hop = 0; ; hop++) {
    // Never auto-follow at the platform level: the runner reports the ACTUAL response its URL
    // returns, so a 3xx stays assertable and `contract` can validate a redirect operation.
    const hopHeaders = { ...headers };
    // A cookie belongs to a host, not to a request: recompute it for each hop, and never let a
    // header from the previous host survive into the next one.
    if (opts.cookieHeaderFor && !hasHeader(hopHeaders, "cookie")) {
      const cookie = opts.cookieHeaderFor(currentUrl);
      if (cookie) hopHeaders.Cookie = cookie;
    }
    const requestInit: RequestInit = { method, headers: hopHeaders, redirect: "manual" };
    if (body !== undefined) requestInit.body = body;
    if (timeoutMs !== undefined && timeoutMs > 0) requestInit.signal = AbortSignal.timeout(timeoutMs);
    const response = await opts.fetch(currentUrl, requestInit);
    opts.onResponse?.(currentUrl, response);

    const location = response.headers.get("location");
    if (hop >= maxRedirects || !REDIRECT_STATUSES.has(response.status) || !location) {
      return { response, redirects };
    }

    const next = resolveLocation(currentUrl, location);
    if (!next) return { response, redirects };
    await response.arrayBuffer().catch(() => {}); // drain before reusing the connection
    ({ method, body, headers } = nextHop(response.status, method, body, headers, currentUrl, next));
    currentUrl = next;
    redirects.push(next);
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

/** Resolve a `Location` (absolute or relative) against the URL that produced it. */
function resolveLocation(from: string, location: string): string | undefined {
  try {
    return new URL(location, from).toString();
  } catch {
    return undefined;
  }
}

/**
 * Decide the method, body and headers for the next hop.
 *
 * 303 always becomes a bodiless GET (RFC 9110). 301/302 on a non-GET/HEAD is converted to GET by
 * every real client, so match that rather than the letter of the spec. 307/308 preserve both.
 * In all cases `Authorization` (and `Cookie`) are dropped when the origin changes, so a redirect
 * can't walk a credential to a host the user never named.
 */
function nextHop(
  status: number,
  method: string,
  body: string | FormData | undefined,
  headers: Record<string, string>,
  from: string,
  to: string,
): { method: string; body: string | FormData | undefined; headers: Record<string, string> } {
  const next = { ...headers };
  if (!sameOrigin(from, to)) {
    for (const key of Object.keys(next)) {
      const lower = key.toLowerCase();
      if (lower === "authorization" || lower === "cookie") delete next[key];
    }
  }
  const downgrade = status === 303 || ((status === 301 || status === 302) && method !== "GET" && method !== "HEAD");
  if (!downgrade) return { method, body, headers: next };
  for (const key of Object.keys(next)) {
    // The body is gone, so its content headers would describe nothing.
    const lower = key.toLowerCase();
    if (lower === "content-type" || lower === "content-length") delete next[key];
  }
  return { method: "GET", body: undefined, headers: next };
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
