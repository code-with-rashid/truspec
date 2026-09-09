import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFetch, bypassesProxy, mergeTransport, transportFromEnv } from "../src/transport";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-transport-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("transportFromEnv", () => {
  it("reads a proxy from the usual variables, preferring the TruSpec-specific one", () => {
    expect(transportFromEnv({ HTTPS_PROXY: "http://a:1" }).proxy).toBe("http://a:1");
    expect(transportFromEnv({ http_proxy: "http://b:2" }).proxy).toBe("http://b:2");
    expect(transportFromEnv({ TRUSPEC_PROXY: "http://c:3", HTTPS_PROXY: "http://a:1" }).proxy).toBe(
      "http://c:3",
    );
  });

  it("reads an extra CA from NODE_EXTRA_CA_CERTS", () => {
    expect(transportFromEnv({ NODE_EXTRA_CA_CERTS: "/etc/ca.pem" }).ca).toEqual(["/etc/ca.pem"]);
  });

  it("never turns off verification from an ambient variable", () => {
    // Turning off TLS verification must be visible at the call site, not inherited from a variable
    // someone set months ago for an unrelated tool.
    expect(transportFromEnv({ NODE_TLS_REJECT_UNAUTHORIZED: "0" }).insecure).toBeUndefined();
  });

  it("returns nothing when the environment says nothing", () => {
    expect(transportFromEnv({})).toEqual({});
  });
});

describe("mergeTransport", () => {
  it("lets an explicit flag win over the environment, per field", () => {
    const merged = mergeTransport({ proxy: "http://env:1", ca: ["/env.pem"] }, { proxy: "http://flag:2" });
    expect(merged.proxy).toBe("http://flag:2");
    expect(merged.ca).toEqual(["/env.pem"]);
  });

  it("does not let an absent or false flag erase an environment value", () => {
    const merged = mergeTransport({ proxy: "http://env:1" }, { proxy: undefined, insecure: false });
    expect(merged.proxy).toBe("http://env:1");
    expect(merged.insecure).toBeUndefined();
  });
});

describe("buildFetch", () => {
  it("returns undefined when nothing is configured, so the global fetch is used unchanged", () => {
    expect(buildFetch({}, dir)).toBeUndefined();
    expect(buildFetch({ insecure: false }, dir)).toBeUndefined();
  });

  it("builds a working fetch when a transport option is set", async () => {
    const server = createServer((_q, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const f = buildFetch({ insecure: true }, dir);
      expect(f).toBeDefined();
      const response = await f!(`http://127.0.0.1:${port}/x`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('{"ok":true}');
    } finally {
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  it("resolves certificate paths relative to the working directory", () => {
    writeFileSync(join(dir, "ca.pem"), "-----BEGIN CERTIFICATE-----\nnot-a-real-cert\n-----END CERTIFICATE-----\n");
    // Reading is what would throw for a bad path; a malformed body is only rejected at handshake.
    expect(() => buildFetch({ ca: ["ca.pem"] }, dir)).not.toThrow();
  });

  it("reports a missing certificate file rather than failing later at connect time", () => {
    expect(() => buildFetch({ ca: ["nope.pem"] }, dir)).toThrow(/ENOENT|no such file/i);
  });
});

describe("bypassesProxy", () => {
  it("bypasses an exact host, and a subdomain of a bare suffix entry", () => {
    expect(bypassesProxy("http://127.0.0.1:3000/x", "127.0.0.1")).toBe(true);
    expect(bypassesProxy("https://api.example.com/x", "example.com")).toBe(true);
    expect(bypassesProxy("https://example.com/x", "example.com")).toBe(true);
    expect(bypassesProxy("https://api.example.com/x", ".example.com")).toBe(true);
  });

  it("matches on a label boundary, so a lookalike host is still proxied", () => {
    // The bug a naive `endsWith` gives you: notexample.com is a different company.
    expect(bypassesProxy("https://notexample.com/x", "example.com")).toBe(false);
    expect(bypassesProxy("https://example.com.evil.net/x", "example.com")).toBe(false);
  });

  it("honours `*` as bypass-everything", () => {
    expect(bypassesProxy("https://anything.at.all/x", "*")).toBe(true);
  });

  it("respects a port pinned on the entry", () => {
    expect(bypassesProxy("http://localhost:3000/x", "localhost:3000")).toBe(true);
    expect(bypassesProxy("http://localhost:4000/x", "localhost:3000")).toBe(false);
    // A default port counts as the port.
    expect(bypassesProxy("https://internal.corp/x", "internal.corp:443")).toBe(true);
    expect(bypassesProxy("http://internal.corp/x", "internal.corp:80")).toBe(true);
  });

  it("is case-insensitive and tolerates whitespace and empty entries", () => {
    expect(bypassesProxy("https://API.Example.COM/x", " example.com , ")).toBe(true);
    expect(bypassesProxy("https://api.example.com/x", ",,")).toBe(false);
  });

  it("proxies when there is no list, and never throws on a malformed URL", () => {
    expect(bypassesProxy("https://example.com/x", undefined)).toBe(false);
    expect(bypassesProxy("https://example.com/x", "")).toBe(false);
    expect(bypassesProxy("not a url", "example.com")).toBe(false);
  });

  it("handles a bracketed IPv6 host", () => {
    expect(bypassesProxy("http://[::1]:8080/x", "::1")).toBe(true);
    expect(bypassesProxy("http://[::1]:8080/x", "[::1]")).toBe(true);
  });
});

describe("transportFromEnv reads the bypass list", () => {
  it("picks up NO_PROXY, no_proxy and TRUSPEC_NO_PROXY", () => {
    expect(transportFromEnv({ NO_PROXY: "a.com" }).noProxy).toBe("a.com");
    expect(transportFromEnv({ no_proxy: "b.com" }).noProxy).toBe("b.com");
    // The namespaced one wins, same as TRUSPEC_PROXY does for the proxy itself.
    expect(transportFromEnv({ TRUSPEC_NO_PROXY: "c.com", NO_PROXY: "a.com" }).noProxy).toBe("c.com");
  });

  it("leaves it unset when the environment says nothing", () => {
    expect(transportFromEnv({}).noProxy).toBeUndefined();
  });
});
