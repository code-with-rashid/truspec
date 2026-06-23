import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startWebServer, type WebServerHandle } from "../server/index";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

/** GET against the running server while spoofing the Host header. */
function get(port: number, hostHeader: string, path = "/api/state"): Promise<{ status: number }> {
  return new Promise((res, rej) => {
    const r = httpRequest(
      { host: "127.0.0.1", port, path, method: "GET", headers: { host: hostHeader } },
      (resp) => {
        resp.resume();
        resp.on("end", () => res({ status: resp.statusCode ?? 0 }));
      },
    );
    r.on("error", rej);
    r.end();
  });
}

/** POST a JSON body through the real server (exercises the capped body read). */
function post(port: number, path: string, payload: unknown): Promise<{ status: number }> {
  return new Promise((res, rej) => {
    const data = JSON.stringify(payload);
    const r = httpRequest(
      { host: "127.0.0.1", port, path, method: "POST", headers: { host: "localhost", "content-type": "application/json" } },
      (resp) => {
        resp.resume();
        resp.on("end", () => res({ status: resp.statusCode ?? 0 }));
      },
    );
    r.on("error", rej);
    r.end(data);
  });
}

describe("web server host guard (DNS-rebinding defense)", () => {
  let handle: WebServerHandle;
  beforeAll(async () => {
    handle = await startWebServer({ dir: resolve(repoRoot, "examples", "petstore"), host: "127.0.0.1", port: 0 });
  });
  afterAll(async () => {
    await handle.close();
  });

  it("allows loopback Host headers", async () => {
    expect((await get(handle.port, `localhost:${handle.port}`)).status).toBe(200);
    expect((await get(handle.port, `127.0.0.1:${handle.port}`)).status).toBe(200);
  });

  it("refuses a rebound (non-loopback) Host header", async () => {
    expect((await get(handle.port, "evil.com")).status).toBe(403);
    expect((await get(handle.port, "attacker.example:80")).status).toBe(403);
  });

  it("answers 400 on a malformed percent-encoded path instead of hanging/crashing", async () => {
    expect((await get(handle.port, `localhost:${handle.port}`, "/%ZZ")).status).toBe(400);
  });

  it("accepts a normal small POST body", async () => {
    expect((await post(handle.port, "/api/run", {})).status).toBe(200);
  });

  // CSRF / clickjacking: a malicious site the user visits must not be able to trigger their
  // collection to run, nor frame the local UI.
  function reqWith(port: number, method: string, path: string, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
    return new Promise((res, rej) => {
      // default Host = the real host:port a browser would send (so Origin-vs-Host matching is exercised)
      const r = httpRequest({ host: "127.0.0.1", port, path, method, headers: { host: `localhost:${port}`, ...headers } }, (resp) => {
        resp.resume();
        resp.on("end", () => res({ status: resp.statusCode ?? 0, headers: resp.headers }));
      });
      r.on("error", rej);
      r.end(method === "POST" ? "{}" : undefined);
    });
  }

  it("refuses cross-origin POSTs — cross-site AND cross-PORT loopback (CSRF defense)", async () => {
    const p = handle.port;
    // a 'simple' cross-origin request (text/plain skips preflight) must be rejected before it runs
    expect((await reqWith(p, "POST", "/api/run", { origin: "http://evil.com", "content-type": "text/plain" })).status).toBe(403);
    expect((await reqWith(p, "POST", "/api/run", { origin: "null", "content-type": "text/plain" })).status).toBe(403);
    // a page on ANOTHER LOCAL PORT is still cross-origin — a bare loopback check would wrongly allow it
    expect((await reqWith(p, "POST", "/api/run", { origin: `http://localhost:${p + 1}`, "content-type": "text/plain" })).status).toBe(403);
    expect((await reqWith(p, "POST", "/api/run", { origin: "http://127.0.0.1:9999", "content-type": "text/plain" })).status).toBe(403);
  });

  it("allows same-origin (matching Host) and origin-less (curl/CI/MCP) API requests", async () => {
    const p = handle.port;
    expect((await reqWith(p, "POST", "/api/run", { origin: `http://localhost:${p}`, "content-type": "application/json" })).status).toBe(200);
    expect((await reqWith(p, "POST", "/api/run", { "content-type": "application/json" })).status).toBe(200); // no Origin
  });

  it("sends anti-framing headers on every response (clickjacking defense)", async () => {
    const r = await reqWith(handle.port, "GET", "/", {});
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(String(r.headers["content-security-policy"])).toMatch(/frame-ancestors 'none'/);
  });

  it("survives a POST aborted mid-body without an unhandledRejection", async () => {
    const seen: unknown[] = [];
    const onRej = (e: unknown): void => {
      seen.push(e);
    };
    process.on("unhandledRejection", onRej);
    try {
      await new Promise<void>((res) => {
        const sock = connect(handle.port, "127.0.0.1", () => {
          // Promise 1000 bytes, send a few, then yank the socket.
          sock.write(
            'POST /api/run HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1000\r\nContent-Type: application/json\r\n\r\n{ "',
          );
          setTimeout(() => {
            sock.destroy();
            res();
          }, 80);
        });
        sock.on("error", () => res());
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(seen).toHaveLength(0);
      // server is still healthy
      expect((await get(handle.port, `localhost:${handle.port}`)).status).toBe(200);
    } finally {
      process.off("unhandledRejection", onRej);
    }
  });
});
