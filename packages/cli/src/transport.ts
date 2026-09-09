import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";

export interface TransportFlags {
  /** Skip TLS certificate verification. */
  insecure?: boolean;
  /** Proxy URL for outbound requests, e.g. `http://proxy.corp:8080`. */
  proxy?: string;
  /**
   * Hosts that must bypass `proxy`, in `NO_PROXY` syntax: a comma-separated list of host names,
   * `.suffix` entries, `host:port` entries, or a single `*` meaning "never proxy".
   */
  noProxy?: string;
  /** Extra CA certificate file(s) to trust, for a private/internal CA. */
  ca?: string[];
  /** Client certificate and key, for mutual TLS. */
  clientCert?: string;
  clientKey?: string;
  /** Passphrase for an encrypted client key. */
  clientKeyPassphrase?: string;
}

/**
 * Does `url` match one of the `NO_PROXY` entries?
 *
 * Follows the de-facto convention curl, wget and the Python/Go clients share: `*` bypasses
 * everything; an entry may name a host, a `.suffix`, or a `host:port`; a bare suffix matches a
 * host that ends with it on a label boundary, so `example.com` covers `api.example.com` but not
 * `notexample.com`. Matching is case-insensitive, and a port on the entry must match the URL's.
 */
export function bypassesProxy(url: string, noProxy: string | undefined): boolean {
  if (!noProxy) return false;
  const entries = noProxy.split(",").map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) return false;
  if (entries.includes("*")) return true;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");

  for (const raw of entries) {
    let entry = raw.toLowerCase();
    let entryPort: string | undefined;

    // An entry may pin a port; when it does, both must agree. Detecting that cannot be "text after
    // the last colon", because a bare IPv6 address is nothing but colons — `::1` would parse as
    // host `:` on port `1`. Only a bracketed address or a single-colon name carries a port.
    if (entry.startsWith("[")) {
      const close = entry.indexOf("]");
      if (close !== -1) {
        const after = entry.slice(close + 1);
        if (after.startsWith(":") && /^\d+$/.test(after.slice(1))) entryPort = after.slice(1);
        entry = entry.slice(1, close);
      }
    } else if ((entry.match(/:/g) ?? []).length === 1) {
      const [name, maybePort] = entry.split(":");
      if (maybePort && /^\d+$/.test(maybePort)) {
        entryPort = maybePort;
        entry = name ?? "";
      }
    }
    if (entryPort !== undefined && entryPort !== port) continue;

    entry = entry.replace(/^\.+/, "");
    if (!entry) continue;
    if (host === entry || host.endsWith(`.${entry}`)) return true;
  }
  return false;
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

  const direct = new Agent({ connect });
  const proxied = flags.proxy
    ? new ProxyAgent({ uri: flags.proxy, ...(wantsTls ? { requestTls: connect } : {}) })
    : undefined;

  // The proxy decision is per-host, not per-run: `NO_PROXY` exists precisely so the dev server on
  // localhost and the internal host next door are reachable while everything else goes through the
  // corporate proxy. Choosing one dispatcher up front cannot express that.
  const pick = (input: string | URL | Request): Agent | ProxyAgent => {
    if (!proxied) return direct;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return bypassesProxy(url, flags.noProxy) ? direct : proxied;
  };

  // `fetch` has no standard way to carry a TLS/proxy configuration, so this uses undici's — the
  // same implementation Node's own global `fetch` is built on, just with a dispatcher attached.
  return ((input: string | URL | Request, init?: RequestInit) =>
    undiciFetch(input as never, Object.assign({}, init, { dispatcher: pick(input) }) as never)) as unknown as typeof globalThis.fetch;
}

/**
 * Read transport settings from the environment, so CI can configure them once for every command.
 * Explicit flags win over these.
 */
export function transportFromEnv(env: NodeJS.ProcessEnv): TransportFlags {
  const out: TransportFlags = {};
  const proxy = env.TRUSPEC_PROXY || env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (proxy) out.proxy = proxy;
  // Honour the standard bypass list. Without it, setting a proxy in the environment silently
  // routes localhost and every internal host through it too, with no way to opt out.
  const noProxy = env.TRUSPEC_NO_PROXY || env.NO_PROXY || env.no_proxy;
  if (noProxy) out.noProxy = noProxy;
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
