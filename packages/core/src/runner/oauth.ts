import { createHash } from "node:crypto";
import type { TruSpecAuth } from "../format/types";
import { interpolate, type Vars } from "./interpolate";

/** An OAuth2 auth block, narrowed out of the auth union. */
export type OAuth2Auth = Extract<TruSpecAuth, { type: "oauth2" }>;

export interface CachedToken {
  accessToken: string;
  /** Epoch ms after which the token must be re-fetched. */
  expiresAt: number;
}

/**
 * Per-run token cache. A collection of twenty requests sharing one folder-level OAuth2 block
 * should hit the token endpoint **once**, not twenty times — that is both a real rate-limit
 * hazard and, on providers that bill per token, a real cost.
 */
export type TokenCache = Map<string, CachedToken>;

export interface TokenOptions {
  vars: Vars;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  cache?: TokenCache;
  /** Timeout for the token request itself; defaults to the run's request timeout. */
  timeoutMs?: number;
}

export interface TokenSuccess {
  ok: true;
  /** Full `Authorization` header value, e.g. `Bearer eyJ…`. */
  header: string;
  /** Whether this came from the cache rather than the network (surfaced in tests + diagnostics). */
  cached: boolean;
}

export interface TokenFailure {
  ok: false;
  error: string;
}

/** Re-fetch this long before nominal expiry, so a token can't expire mid-flight. */
const EXPIRY_SKEW_MS = 30_000;
/** Providers may omit `expires_in`; assume a conservative five minutes rather than caching forever. */
const DEFAULT_TTL_MS = 300_000;

/**
 * Acquire (or reuse) an OAuth2 access token and return the `Authorization` header to send.
 *
 * Never throws: a token failure is a request failure with a readable reason, in the same shape as
 * every other runner error, so a CI log says *why* the gate failed rather than dumping a stack.
 */
export async function resolveOAuthToken(
  auth: OAuth2Auth,
  opts: TokenOptions,
): Promise<TokenSuccess | TokenFailure> {
  const missing: string[] = [];
  const fill = (t: string | undefined): string | undefined => {
    if (t === undefined) return undefined;
    const r = interpolate(t, opts.vars);
    missing.push(...r.missing);
    return r.value;
  };

  const tokenUrl = fill(auth.tokenUrl) ?? "";
  const clientId = fill(auth.clientId);
  const clientSecret = fill(auth.clientSecret);
  const username = fill(auth.username);
  const password = fill(auth.password);
  const refreshToken = fill(auth.refreshToken);
  const scope = fill(auth.scope);
  const audience = fill(auth.audience);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(auth.extra ?? {})) extra[k] = fill(v) ?? "";

  if (missing.length > 0) {
    const unique = [...new Set(missing)].map((m) => `{{${m}}}`).join(", ");
    return { ok: false, error: `OAuth2: unresolved variables in the auth block: ${unique}` };
  }
  const required = requiredFields(auth.grant, { clientId, username, password, refreshToken });
  if (required) return { ok: false, error: `OAuth2: ${required}` };

  const form = new URLSearchParams({ grant_type: auth.grant });
  if (scope) form.set("scope", scope);
  if (audience) form.set("audience", audience);
  if (auth.grant === "password") {
    form.set("username", username ?? "");
    form.set("password", password ?? "");
  }
  if (auth.grant === "refresh_token") form.set("refresh_token", refreshToken ?? "");
  for (const [k, v] of Object.entries(extra)) form.set(k, v);

  const now = opts.now ?? (() => Date.now());
  const cacheKey = tokenCacheKey(tokenUrl, auth.clientAuth, clientId, clientSecret, form);
  const hit = opts.cache?.get(cacheKey);
  if (hit && hit.expiresAt > now()) {
    return { ok: true, header: `${auth.scheme} ${hit.accessToken}`, cached: true };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (auth.clientAuth === "basic") {
    // RFC 6749 §2.3.1: the client id/secret go in an HTTP Basic header. Some providers accept
    // only this form, others only the body form, so it is configurable rather than guessed.
    headers.Authorization = `Basic ${Buffer.from(`${clientId ?? ""}:${clientSecret ?? ""}`, "utf8").toString("base64")}`;
  } else {
    if (clientId) form.set("client_id", clientId);
    if (clientSecret) form.set("client_secret", clientSecret);
  }

  const doFetch = opts.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    const init: RequestInit = { method: "POST", headers, body: form.toString(), redirect: "manual" };
    if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) init.signal = AbortSignal.timeout(opts.timeoutMs);
    response = await doFetch(tokenUrl, init);
  } catch (e) {
    return { ok: false, error: `OAuth2: token request to ${tokenUrl} failed: ${(e as Error).message}` };
  }

  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    // The provider's own error body is the single most useful thing here (`invalid_client`,
    // `unsupported_grant_type`, …), so surface a trimmed version rather than just the status.
    return {
      ok: false,
      error: `OAuth2: token endpoint returned ${response.status}${summarize(bodyText)}`,
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return { ok: false, error: `OAuth2: token endpoint did not return JSON${summarize(bodyText)}` };
  }
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const accessToken = record.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return { ok: false, error: "OAuth2: token response had no access_token" };
  }

  const expiresIn = typeof record.expires_in === "number" ? record.expires_in * 1000 : DEFAULT_TTL_MS;
  opts.cache?.set(cacheKey, {
    accessToken,
    expiresAt: now() + Math.max(expiresIn - EXPIRY_SKEW_MS, 0),
  });
  return { ok: true, header: `${auth.scheme} ${accessToken}`, cached: false };
}

/**
 * Cache key for an access token: everything that decides *which* token comes back.
 *
 * It used to be built from a hand-picked subset — grant, url, clientId, username, scope, audience
 * — which omitted the two fields that most often distinguish one token from another. Two requests
 * with different `refreshToken`s (one per user, the ordinary way to test a multi-tenant API), or
 * different `extra.resource` / `extra.tenant`, produced the same key, so the second silently
 * reused the first's token. The visible outcome is a 401 you cannot explain; the invisible one is
 * a request that passes as the wrong identity.
 *
 * So the key is the whole resolved token request. Hashed because it contains the client secret and
 * password, and a key that carries those is a key that must never be printed.
 */
function tokenCacheKey(
  tokenUrl: string,
  clientAuth: string,
  clientId: string | undefined,
  clientSecret: string | undefined,
  form: URLSearchParams,
): string {
  const body = [...form.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`);
  const material = [tokenUrl, clientAuth, clientId ?? "", clientSecret ?? "", ...body].join("\u0000");
  return createHash("sha256").update(material).digest("hex");
}

function requiredFields(
  grant: OAuth2Auth["grant"],
  v: { clientId?: string; username?: string; password?: string; refreshToken?: string },
): string | undefined {
  if (grant === "client_credentials" && !v.clientId) return "client_credentials grant needs clientId";
  if (grant === "password" && (!v.username || !v.password)) {
    return "password grant needs username and password";
  }
  if (grant === "refresh_token" && !v.refreshToken) return "refresh_token grant needs refreshToken";
  return undefined;
}

/** A short, single-line excerpt of a provider error body — enough to diagnose, short enough to log. */
function summarize(bodyText: string): string {
  const trimmed = bodyText.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return `: ${trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed}`;
}
