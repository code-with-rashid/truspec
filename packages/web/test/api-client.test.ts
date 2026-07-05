import { afterEach, describe, expect, it, vi } from "vitest";
import { coverage, drift, getRequest, getState, mockLog, mockStart, mockStatus, mockStop, run, saveRequest } from "../src/api";

// The client api.ts is browser code but uses the global fetch, so it's unit-testable in node
// with a stub. We assert the URL + method + body each helper sends, and the error path.
function stub(impl: (url: string, init?: RequestInit) => Response): { calls: Array<[string, RequestInit | undefined]> } {
  const calls: Array<[string, RequestInit | undefined]> = [];
  vi.stubGlobal("fetch", (async (url: string, init?: RequestInit) => { calls.push([String(url), init]); return impl(String(url), init); }) as typeof fetch);
  return { calls };
}
const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("web client api", () => {
  it("getState GETs /api/state", async () => {
    const s = stub(() => ok({ dir: "/x", requests: [], environments: [], specs: [] }));
    const r = await getState();
    expect(r.dir).toBe("/x");
    expect(s.calls[0][0]).toBe("/api/state");
  });

  it("getRequest encodes the path query param", async () => {
    const s = stub(() => ok({ name: "n", method: "GET", url: "u" }));
    await getRequest("a b/c.tspec.yaml");
    expect(s.calls[0][0]).toBe("/api/request?path=a%20b%2Fc.tspec.yaml");
  });

  it("run POSTs target+env to /api/run", async () => {
    const s = stub(() => ok({ results: [], passed: 0, failed: 0, ok: true, missingSecrets: [] }));
    await run("dir", "local");
    expect(s.calls[0][0]).toBe("/api/run");
    expect(s.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(s.calls[0][1]?.body))).toEqual({ target: "dir", env: "local" });
  });

  it("run also POSTs spec when given (contract validation)", async () => {
    const s = stub(() => ok({ results: [], passed: 0, failed: 0, ok: true, missingSecrets: [] }));
    await run("dir", "local", "openapi.yaml");
    expect(JSON.parse(String(s.calls[0][1]?.body))).toEqual({ target: "dir", env: "local", spec: "openapi.yaml" });
  });

  it("drift and coverage POST the spec", async () => {
    const s = stub((url) => ok(url.includes("drift") ? { specOperations: 1, collectionOperations: 0, added: [], removed: [], changed: [], ok: true } : { total: 1, covered: [], uncovered: [], percent: 0, ok: false }));
    await drift("openapi.yaml");
    await coverage("openapi.yaml");
    expect(s.calls.map((c) => c[0])).toEqual(["/api/drift", "/api/coverage"]);
    expect(JSON.parse(String(s.calls[0][1]?.body))).toEqual({ spec: "openapi.yaml" });
  });

  it("saveRequest POSTs path+content", async () => {
    const s = stub(() => ok({ ok: true, path: "x.tspec.yaml" }));
    const r = await saveRequest("x.tspec.yaml", "name: x");
    expect(r.ok).toBe(true);
    expect(JSON.parse(String(s.calls[0][1]?.body))).toEqual({ path: "x.tspec.yaml", content: "name: x" });
  });

  it("throws on a non-ok HTTP status", async () => {
    stub(() => new Response("nope", { status: 500 }));
    await expect(getState()).rejects.toThrow(/HTTP 500/);
  });

  it("mockStatus GETs /api/mock/status", async () => {
    const s = stub(() => ok({ running: true, port: 4000 }));
    const r = await mockStatus();
    expect(r.running).toBe(true);
    expect(s.calls[0][0]).toBe("/api/mock/status");
  });

  it("mockStart POSTs spec+port to /api/mock/start", async () => {
    const s = stub(() => ok({ ok: true, running: true, port: 4000 }));
    await mockStart("openapi.yaml", 4000);
    expect(s.calls[0][0]).toBe("/api/mock/start");
    expect(JSON.parse(String(s.calls[0][1]?.body))).toEqual({ spec: "openapi.yaml", port: 4000 });
  });

  it("mockStop POSTs to /api/mock/stop", async () => {
    const s = stub(() => ok({ ok: true }));
    await mockStop();
    expect(s.calls[0][0]).toBe("/api/mock/stop");
    expect(s.calls[0][1]?.method).toBe("POST");
  });

  it("mockLog GETs /api/mock/log", async () => {
    const s = stub(() => ok({ log: [] }));
    await mockLog();
    expect(s.calls[0][0]).toBe("/api/mock/log");
  });
});
