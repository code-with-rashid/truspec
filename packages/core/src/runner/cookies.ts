export interface Cookie {
  name: string;
  value: string;
  /** Host the cookie applies to, lower-cased and without a leading dot. */
  domain: string;
  path: string;
  /** Epoch ms; `undefined` for a session cookie (lives for the run). */
  expires?: number;
  secure: boolean;
  httpOnly: boolean;
  hostOnly: boolean;
  sameSite?: string;
}

/**
 * An in-memory cookie jar scoped to a single run.
 *
 * A login request that sets a session cookie is the most common multi-request flow there is, and
 * without a jar it can only be expressed by capturing the header by hand. The jar is per run and
 * never touches disk: a collection run in CI must not inherit state from a previous one, and a
 * session cookie is a credential that has no business being written into a repository.
 */
export class CookieJar {
  /** Keyed by `domain\0path\0name`, the tuple RFC 6265 treats as a cookie's identity. */
  private readonly store = new Map<string, Cookie>();

  /** Record every `Set-Cookie` from a response at `url`. Invalid or foreign cookies are ignored. */
  setFromResponse(url: string, setCookieHeaders: readonly string[], now = Date.now()): void {
    let origin: URL;
    try {
      origin = new URL(url);
    } catch {
      return;
    }
    for (const header of setCookieHeaders) {
      const cookie = parseSetCookie(header, origin);
      if (!cookie) continue;
      const key = `${cookie.domain}\u0000${cookie.path}\u0000${cookie.name}`;
      // A cookie already past its expiry is a deletion instruction, not a value to keep.
      if (cookie.expires !== undefined && cookie.expires <= now) this.store.delete(key);
      else this.store.set(key, cookie);
    }
  }

  /** The `Cookie` header value to send to `url`, or `undefined` when nothing matches. */
  headerFor(url: string, now = Date.now()): string | undefined {
    const matches = this.match(url, now);
    if (matches.length === 0) return undefined;
    return matches.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  /** Cookies that would be sent to `url`, most specific path first (RFC 6265 §5.4 ordering). */
  match(url: string, now = Date.now()): Cookie[] {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return [];
    }
    const host = target.hostname.toLowerCase();
    const isSecure = isSecureOrigin(target);
    const out: Cookie[] = [];
    for (const [key, cookie] of this.store) {
      if (cookie.expires !== undefined && cookie.expires <= now) {
        this.store.delete(key);
        continue;
      }
      if (cookie.secure && !isSecure) continue;
      if (!domainMatches(host, cookie)) continue;
      if (!pathMatches(target.pathname || "/", cookie.path)) continue;
      out.push(cookie);
    }
    return out.sort((a, b) => b.path.length - a.path.length || a.name.localeCompare(b.name));
  }

  /** Every stored cookie, for reporting. */
  all(): Cookie[] {
    return [...this.store.values()];
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Whether an origin counts as secure for cookie purposes.
 *
 * Loopback is secure, as every browser has treated it since 2020. It matters here more than
 * anywhere: `http://localhost` is what a TruSpec collection points at all day, and a dev server
 * that sets `Secure` on its session cookie (the default in Rails, Django and most Express setups)
 * had that cookie stored and then never sent — the login returns 200, the next request 401, and
 * nothing in the collection explains it.
 */
export function isSecureOrigin(url: URL): boolean {
  if (url.protocol === "https:" || url.protocol === "wss:") return true;
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/** RFC 6265 §5.1.3: exact host match, or a suffix match on a non-host-only cookie. */
function domainMatches(host: string, cookie: Cookie): boolean {
  if (host === cookie.domain) return true;
  if (cookie.hostOnly) return false;
  // Require a dot boundary so `evilexample.com` does not match a cookie for `example.com`.
  return host.endsWith(`.${cookie.domain}`);
}

/** RFC 6265 §5.1.4: equal, a prefix ending in `/`, or a prefix followed by `/`. */
function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

/** The default path for a cookie set at `pathname` (RFC 6265 §5.1.4). */
function defaultPath(pathname: string): string {
  if (!pathname.startsWith("/")) return "/";
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

function parseSetCookie(header: string, origin: URL): Cookie | undefined {
  const parts = header.split(";");
  const first = parts[0] ?? "";
  const eq = first.indexOf("=");
  if (eq <= 0) return undefined;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name) return undefined;

  const host = origin.hostname.toLowerCase();
  const cookie: Cookie = {
    name,
    value,
    domain: host,
    path: defaultPath(origin.pathname),
    secure: false,
    httpOnly: false,
    hostOnly: true,
  };

  for (const attr of parts.slice(1)) {
    const idx = attr.indexOf("=");
    const key = (idx === -1 ? attr : attr.slice(0, idx)).trim().toLowerCase();
    const val = idx === -1 ? "" : attr.slice(idx + 1).trim();
    switch (key) {
      case "domain": {
        const domain = val.replace(/^\./, "").toLowerCase();
        // A cookie may only widen to a domain the response's host belongs to; anything else is a
        // cross-site set attempt and is dropped rather than stored.
        if (!domain || !(host === domain || host.endsWith(`.${domain}`))) break;
        // A single-label domain — `com`, `test`, `internal` — scopes the cookie to an entire
        // suffix, so one host's cookie rides along on requests to every other host under it. A
        // run that talks to an auth server and an API is exactly where that bites. Browsers
        // refuse it; so does this. (The cookie stays host-only, which is what was meant anyway.)
        if (!domain.includes(".")) break;
        cookie.domain = domain;
        cookie.hostOnly = false;
        break;
      }
      case "path":
        if (val.startsWith("/")) cookie.path = val;
        break;
      case "secure":
        cookie.secure = true;
        break;
      case "httponly":
        cookie.httpOnly = true;
        break;
      case "samesite":
        cookie.sameSite = val;
        break;
      case "max-age": {
        const seconds = Number(val);
        // Max-Age wins over Expires when both are present (RFC 6265 §5.3).
        if (Number.isFinite(seconds)) cookie.expires = Date.now() + seconds * 1000;
        break;
      }
      case "expires": {
        if (cookie.expires !== undefined) break;
        const at = Date.parse(val);
        if (!Number.isNaN(at)) cookie.expires = at;
        break;
      }
      default:
        break;
    }
  }

  // RFC 6265bis §4.1.3. A `__Host-`/`__Secure-` name is a promise about how the cookie is scoped,
  // and storing one that breaks the promise is worse than ignoring prefixes altogether: the name
  // says host-only while the jar hands it to every sibling host.
  if (name.startsWith("__Secure-") && !cookie.secure) return undefined;
  if (name.startsWith("__Host-") && (!cookie.secure || !cookie.hostOnly || cookie.path !== "/")) {
    return undefined;
  }
  return cookie;
}

/**
 * Pull every `Set-Cookie` out of a response.
 *
 * `Headers.get("set-cookie")` comma-joins repeated headers, which corrupts cookies whose
 * `Expires` attribute legitimately contains a comma — so use `getSetCookie()` where the runtime
 * provides it (Node 20+, modern browsers) and fall back only when it does not.
 */
export function setCookiesOf(response: { headers: Headers }): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}
