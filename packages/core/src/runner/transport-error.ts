/**
 * Turn a thrown transport failure into something a person can act on.
 *
 * `fetch` reports every network failure as the same five characters — `fetch failed` — and puts the
 * only useful part (an `ECONNREFUSED`, an expired certificate, a DNS miss) in a `cause` nobody
 * prints. A run that says "Request failed: fetch failed" tells you a request failed, which you
 * already knew. This walks the cause chain, finds the real reason, and says what to do about it.
 */

/** Node/undici error shape: a `code` and a possibly-nested `cause`. */
interface CausedError {
  message?: unknown;
  code?: unknown;
  name?: unknown;
  cause?: unknown;
  errors?: unknown;
}

const MAX_CAUSE_DEPTH = 8;

/**
 * Collect an error and its `cause` chain, deepest last.
 *
 * `AggregateError` (what Node throws when a host resolves to several addresses and every one of
 * them fails) keeps its real reasons in `errors`, not `cause`, so follow that too — otherwise a
 * dual-stack localhost connection failure unwraps to nothing at all.
 */
function chain(e: unknown): CausedError[] {
  const out: CausedError[] = [];
  const seen = new Set<unknown>();
  let current: unknown = e;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current && typeof current === "object"; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const node = current as CausedError;
    out.push(node);
    if (node.cause !== undefined && node.cause !== null) {
      current = node.cause;
      continue;
    }
    const nested = Array.isArray(node.errors) ? node.errors[0] : undefined;
    if (nested === undefined) break;
    current = nested;
  }
  return out;
}

function codeOf(nodes: CausedError[]): string | undefined {
  for (const n of nodes) {
    if (typeof n.code === "string" && n.code) return n.code;
  }
  return undefined;
}

/** The deepest message that says more than the generic wrapper does. */
function deepestMessage(nodes: CausedError[]): string {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const m = nodes[i]?.message;
    if (typeof m === "string" && m && m !== "fetch failed") return m;
  }
  return "fetch failed";
}

/** `http://host:8080/x` → `host:8080`, for an error that should name what it could not reach. */
function targetOf(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return url;
  }
}

/** What the runner knows about the attempt that failed, for a message that names the limit. */
export interface TransportErrorContext {
  /** The timeout actually in force for this request, in ms. */
  timeoutMs?: number;
  /** How many times the request was sent (1 when there were no retries). */
  attempts?: number;
}

/**
 * A human explanation of a failed send, including the fix where there is an obvious one.
 *
 * The `--insecure` hints name a real CLI flag on purpose: the certificate errors below are the ones
 * that stop people dead against a staging box with a self-signed cert, and the flag exists exactly
 * for that case.
 */
export function describeTransportError(e: unknown, url: string, ctx: TransportErrorContext = {}): string {
  const nodes = chain(e);
  const code = codeOf(nodes);
  const where = targetOf(url);
  const name = nodes[0]?.name;
  // Which limit expired, and how many times it was tried. "Timed out" alone leaves the reader
  // guessing whether it was the request's own `options.timeoutMs`, `--timeout`, or the 30s
  // default — three different files to go and edit.
  const limit = ctx.timeoutMs ? ` after ${ctx.timeoutMs}ms` : "";
  const tries = ctx.attempts && ctx.attempts > 1 ? ` (${ctx.attempts} attempts)` : "";

  // A timeout arrives as a DOMException, not as an errno, so match it by name first.
  if (name === "TimeoutError") return `Timed out waiting for ${where}${limit}${tries}`;
  if (name === "AbortError") return `Request to ${where} was aborted`;

  switch (code) {
    case "ECONNREFUSED":
      return `Connection refused by ${where} — nothing is listening on that port`;
    case "ENOTFOUND":
      return `Host not found: ${where} — check the hostname, or the variable that produced it`;
    case "EAI_AGAIN":
      return `DNS lookup for ${where} failed temporarily — the resolver is unreachable`;
    case "ECONNRESET":
      return `Connection reset by ${where} before a response arrived`;
    case "EPIPE":
      return `Connection to ${where} closed while the request was still being sent`;
    case "EHOSTUNREACH":
      return `No route to ${where}`;
    case "ENETUNREACH":
      return `Network unreachable while connecting to ${where}`;
    case "EACCES":
      return `Not permitted to connect to ${where}`;
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return `Timed out connecting to ${where}${limit}${tries}`;
    case "UND_ERR_HEADERS_TIMEOUT":
      return `${where} accepted the connection but sent no response headers in time`;
    case "UND_ERR_BODY_TIMEOUT":
      return `${where} stopped sending the response body`;
    case "UND_ERR_SOCKET":
      return `Connection to ${where} closed unexpectedly`;
    case "CERT_HAS_EXPIRED":
      return `TLS certificate for ${where} has expired (use --insecure to connect anyway)`;
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return `TLS certificate for ${where} is self-signed (use --insecure, or --ca <file> to trust it)`;
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
      return `TLS certificate for ${where} could not be verified (use --ca <file> to trust its issuer)`;
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return `TLS certificate for ${where} is not valid for that hostname`;
    case "ERR_INVALID_URL":
      return invalidUrl(url);
    default:
      break;
  }

  const message = deepestMessage(nodes);
  // `fetch` refuses a fixed list of port numbers (1, 7, 9, 21, 25, …) outright, and says only
  // "bad port". Nothing you change about the server will fix that, so say what it actually means.
  if (message === "bad port") {
    return `Refusing to connect to ${where}: the HTTP client blocks that port number outright`;
  }
  // `new URL()` is the only thing that rejects the URL before a socket is opened, and an
  // unresolved `{{var}}` is far and away the most common way to get there.
  if (message.includes("Invalid URL") || message.includes("Failed to parse URL")) return invalidUrl(url);
  if (message === "fetch failed") return `Could not reach ${where}`;
  return message;
}

function invalidUrl(url: string): string {
  const unresolved = url.includes("{{")
    ? " — a `{{variable}}` in it was never resolved; declare it in an environment or capture it first"
    : "";
  return `Invalid URL: ${url}${unresolved}`;
}
