import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";

export interface TransportFlags {
  /** Skip TLS certificate verification. */
  insecure?: boolean;
  /** Proxy URL for outbound requests, e.g. `http://proxy.corp:8080`. */
  proxy?: string;
  /** Extra CA certificate file(s) to trust, for a private/internal CA. */
  ca?: string[];
  /** Client certificate and key, for mutual TLS. */
  clientCert?: string;
  clientKey?: string;
  /** Passphrase for an encrypted client key. */
  clientKeyPassphrase?: string;
}

/**
 * Build a `fetch` configured for the network the run happens on, or `undefined` when no transport
 * flag was given (so the default global `fetch` is used, unchanged).
 *
 * **These are CLI flags and environment variables, never request-file fields.** Whether to trust a
 * self-signed certificate or route through a corporate proxy is a property of *where you are
 * running*, not of the request — and a committed file saying "skip TLS verification" is a
 * liability that outlives the afternoon it was needed. curl, git and every CI tool draw the line
 * in the same place.
 */
export function buildFetch(flags: TransportFlags, cwd: string): typeof globalThis.fetch | undefined {
  const wantsTls = flags.insecure || flags.ca?.length || flags.clientCert || flags.clientKey;
  if (!wantsTls && !flags.proxy) return undefined;

  const connect: Record<string, unknown> = {};
  if (flags.insecure) connect.rejectUnauthorized = false;
  if (flags.ca?.length) connect.ca = flags.ca.map((p) => readFileSync(resolve(cwd, p)));
  if (flags.clientCert) connect.cert = readFileSync(resolve(cwd, flags.clientCert));
  if (flags.clientKey) connect.key = readFileSync(resolve(cwd, flags.clientKey));
  if (flags.clientKeyPassphrase) connect.passphrase = flags.clientKeyPassphrase;

  const dispatcher = flags.proxy
    ? new ProxyAgent({ uri: flags.proxy, ...(wantsTls ? { requestTls: connect } : {}) })
    : new Agent({ connect });

  // `fetch` has no standard way to carry a TLS/proxy configuration, so this uses undici's — the
  // same implementation Node's own global `fetch` is built on, just with a dispatcher attached.
  return ((input: string | URL | Request, init?: RequestInit) =>
    undiciFetch(input as never, Object.assign({}, init, { dispatcher }) as never)) as unknown as typeof globalThis.fetch;
}

/**
 * Read transport settings from the environment, so CI can configure them once for every command.
 * Explicit flags win over these.
 */
export function transportFromEnv(env: NodeJS.ProcessEnv): TransportFlags {
  const out: TransportFlags = {};
  const proxy = env.TRUSPEC_PROXY || env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (proxy) out.proxy = proxy;
  if (env.NODE_EXTRA_CA_CERTS) out.ca = [env.NODE_EXTRA_CA_CERTS];
  // Deliberately NOT reading NODE_TLS_REJECT_UNAUTHORIZED: turning off verification is a decision
  // that should be visible at the call site, not inherited from an ambient variable someone set
  // months ago for an unrelated tool.
  return out;
}

/** Merge env-derived defaults with explicit flags (flags win, per-field). */
export function mergeTransport(fromEnv: TransportFlags, flags: TransportFlags): TransportFlags {
  return {
    ...fromEnv,
    ...Object.fromEntries(Object.entries(flags).filter(([, v]) => v !== undefined && v !== false)),
  };
}
