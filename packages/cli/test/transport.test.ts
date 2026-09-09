import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFetch, mergeTransport, transportFromEnv } from "../src/transport";

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
