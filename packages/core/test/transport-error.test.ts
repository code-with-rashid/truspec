import { describe, expect, it } from "vitest";
import { describeTransportError } from "../src/runner";

/** The shape Node/undici actually throws: a generic wrapper around the real errno. */
const fetchFailed = (code: string, message = code): Error => {
  const inner = Object.assign(new Error(message), { code });
  return Object.assign(new TypeError("fetch failed"), { cause: inner });
};

const url = "https://api.example.com:8443/pets";

describe("describeTransportError", () => {
  it("names the cause instead of repeating fetch's five useless characters", () => {
    // The failure this exists for: `Request failed: fetch failed` told you nothing.
    const out = describeTransportError(fetchFailed("ECONNREFUSED"), "http://127.0.0.1:9/x");
    expect(out).toBe("Connection refused by 127.0.0.1:9 — nothing is listening on that port");
    expect(out).not.toContain("fetch failed");
  });

  it("names the host and port it could not reach", () => {
    expect(describeTransportError(fetchFailed("ECONNREFUSED"), url)).toContain("api.example.com:8443");
    expect(describeTransportError(fetchFailed("ECONNREFUSED"), "https://api.example.com/x")).toContain(
      "by api.example.com —",
    );
  });

  it("explains each connection errno in its own terms", () => {
    const cases: Array<[string, RegExp]> = [
      ["ENOTFOUND", /Host not found/],
      ["EAI_AGAIN", /DNS lookup .* failed temporarily/],
      ["ECONNRESET", /Connection reset/],
      ["EPIPE", /closed while the request was still being sent/],
      ["EHOSTUNREACH", /No route to/],
      ["ENETUNREACH", /Network unreachable/],
      ["EACCES", /Not permitted to connect/],
      ["ETIMEDOUT", /Timed out connecting/],
      ["UND_ERR_CONNECT_TIMEOUT", /Timed out connecting/],
      ["UND_ERR_HEADERS_TIMEOUT", /no response headers in time/],
      ["UND_ERR_BODY_TIMEOUT", /stopped sending the response body/],
      ["UND_ERR_SOCKET", /closed unexpectedly/],
    ];
    for (const [code, expected] of cases) {
      expect(describeTransportError(fetchFailed(code), url), code).toMatch(expected);
    }
  });

  it("suggests the flag that gets past each certificate problem", () => {
    expect(describeTransportError(fetchFailed("CERT_HAS_EXPIRED"), url)).toBe(
      "TLS certificate for api.example.com:8443 has expired (use --insecure to connect anyway)",
    );
    expect(describeTransportError(fetchFailed("DEPTH_ZERO_SELF_SIGNED_CERT"), url)).toMatch(/self-signed/);
    expect(describeTransportError(fetchFailed("SELF_SIGNED_CERT_IN_CHAIN"), url)).toMatch(/--ca <file>/);
    expect(describeTransportError(fetchFailed("UNABLE_TO_VERIFY_LEAF_SIGNATURE"), url)).toMatch(/could not be verified/);
    expect(describeTransportError(fetchFailed("ERR_TLS_CERT_ALTNAME_INVALID"), url)).toMatch(/not valid for that hostname/);
  });

  it("recognises a timeout, which arrives as a DOMException with no errno at all", () => {
    const e = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    expect(describeTransportError(e, url)).toBe("Timed out waiting for api.example.com:8443");
    const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(describeTransportError(aborted, url)).toMatch(/was aborted/);
  });

  it("unwraps an AggregateError, which keeps its reasons in `errors` and not in `cause`", () => {
    // A dual-stack localhost that refuses on both ::1 and 127.0.0.1 throws exactly this.
    const agg = Object.assign(new AggregateError([Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })]), {});
    const wrapped = Object.assign(new TypeError("fetch failed"), { cause: agg });
    expect(describeTransportError(wrapped, "http://localhost:9/x")).toMatch(/Connection refused/);
  });

  it("blames the unresolved variable when the URL never became a URL", () => {
    const out = describeTransportError(new TypeError("Invalid URL"), "{{baseUrl}}/pets");
    expect(out).toContain("{{baseUrl}}/pets");
    expect(out).toMatch(/never resolved/);
    // A URL that is simply malformed gets no variable advice it cannot use.
    expect(describeTransportError(new TypeError("Invalid URL"), "ht!tp://x")).not.toMatch(/never resolved/);
  });

  it("walks a deep cause chain and stops at a cycle rather than spinning", () => {
    const a: Error & { cause?: unknown } = new Error("outer");
    const b: Error & { cause?: unknown; code?: string } = Object.assign(new Error("inner"), { code: "ECONNRESET" });
    a.cause = b;
    b.cause = a;
    expect(describeTransportError(a, url)).toMatch(/Connection reset/);
  });

  it("explains a port fetch refuses to dial, which reports only `bad port`", () => {
    const out = describeTransportError(fetchFailed("", "bad port"), "http://127.0.0.1:1/x");
    expect(out).toBe("Refusing to connect to 127.0.0.1:1: the HTTP client blocks that port number outright");
  });

  it("falls back to the deepest real message for a cause it has no advice for", () => {
    expect(describeTransportError(fetchFailed("SOMETHING_NEW", "the socket did a weird thing"), url)).toBe(
      "the socket did a weird thing",
    );
  });

  it("still says something useful when there is no cause at all", () => {
    expect(describeTransportError(new TypeError("fetch failed"), url)).toBe("Could not reach api.example.com:8443");
    expect(describeTransportError("not an error at all", url)).toBe("Could not reach api.example.com:8443");
  });
});

describe("a timeout says which limit expired", () => {
  // "Timed out waiting for host:port" leaves the reader guessing whether it was the request's own
  // options.timeoutMs, --timeout, or the 30s default — three different places to go and edit.
  const timeout = (): Error => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

  it("names the limit in force", () => {
    expect(describeTransportError(timeout(), url, { timeoutMs: 500 })).toBe(
      "Timed out waiting for api.example.com:8443 after 500ms",
    );
  });

  it("says how many times it was tried, when it was tried more than once", () => {
    expect(describeTransportError(timeout(), url, { timeoutMs: 400, attempts: 3 })).toBe(
      "Timed out waiting for api.example.com:8443 after 400ms (3 attempts)",
    );
  });

  it("stays quiet about a single attempt, which is the ordinary case", () => {
    expect(describeTransportError(timeout(), url, { timeoutMs: 400, attempts: 1 })).not.toContain("attempt");
  });

  it("falls back to the plain message when nothing is known about the attempt", () => {
    expect(describeTransportError(timeout(), url)).toBe("Timed out waiting for api.example.com:8443");
  });

  it("names the limit on a connect timeout too", () => {
    const connect = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ETIMEDOUT"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    });
    expect(describeTransportError(connect, url, { timeoutMs: 250 })).toContain("after 250ms");
  });
});
