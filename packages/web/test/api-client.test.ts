import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as api from "../src/api";

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

let calls: Call[];
let respond: () => Response;
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  respond = () => new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    return respond();
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const last = (): Call => calls[calls.length - 1]!;

/**
 * These pin the wire contract between the client and `packages/web/server/api.ts`. The server side
 * is well covered; the client half was not, so a renamed route or a dropped field would have gone
 * unnoticed until someone clicked the button.
 */
describe("web api client", () => {
  it("sends JSON and parses the response", async () => {
    await api.getState();
    expect(last().url).toBe("/api/state");
    expect(last().headers["content-type"]).toBe("application/json");
  });

  it("throws with the path and status when the server rejects", async () => {
    respond = () => new Response("nope", { status: 500 });
    await expect(api.getState()).rejects.toThrow("/api/state → HTTP 500");
  });

  it("encodes a path into the query string rather than concatenating it raw", async () => {
    await api.getRequest("api/a b/c&d.tspec.yaml");
    expect(last().url).toBe("/api/request?path=api%2Fa%20b%2Fc%26d.tspec.yaml");
  });

  it("encodes an environment name the same way", async () => {
    await api.getEnvironment("staging & prod");
    expect(last().url).toBe("/api/environment?name=staging%20%26%20prod");
  });

  it("posts a run with its target, environment and spec", async () => {
    await api.run("api", "local", "openapi.yaml");
    expect(last().url).toBe("/api/run");
    expect(last().method).toBe("POST");
    expect(last().body).toEqual({ target: "api", env: "local", spec: "openapi.yaml" });
  });

  it("posts each import kind to its own route with the expected shape", async () => {
    await api.importPostman({ info: {} }, "dest");
    expect(last().url).toBe("/api/import/postman");
    expect(last().body).toEqual({ json: { info: {} }, targetDir: "dest" });

    await api.importBruno([{ path: "a.bru", content: "x" }]);
    expect(last().url).toBe("/api/import/bruno");
    expect((last().body as { files: unknown[] }).files.length).toBe(1);

    await api.importHar({ log: {} }, "dest", { baseUrlVar: "baseUrl" });
    expect(last().url).toBe("/api/import/har");
    expect(last().body).toEqual({ json: { log: {} }, targetDir: "dest", options: { baseUrlVar: "baseUrl" } });

    await api.importCurlText("curl https://x.test", "dest", "name");
    expect(last().url).toBe("/api/import/curl");
    expect(last().body).toEqual({ text: "curl https://x.test", targetDir: "dest", name: "name" });
  });

  it("posts code generation with the draft request, language, path and environment", async () => {
    await api.codegen({ name: "r" }, "python-requests", "a.tspec.yaml", "local");
    expect(last().url).toBe("/api/codegen");
    expect(last().body).toEqual({
      request: { name: "r" },
      lang: "python-requests",
      path: "a.tspec.yaml",
      env: "local",
    });
    await api.codegenTargets();
    expect(last().url).toBe("/api/codegen/targets");
  });

  it("posts the file-mutating operations to their routes", async () => {
    await api.saveRequest("a.tspec.yaml", "name: a");
    expect(last()).toMatchObject({ url: "/api/request", method: "POST" });

    await api.saveRequestObject("a.tspec.yaml", { name: "a" });
    expect(last().url).toBe("/api/request/object");

    await api.createFolder("api/new");
    expect(last()).toMatchObject({ url: "/api/folder", body: { path: "api/new" } });

    await api.renamePath("a.tspec.yaml", "b.tspec.yaml");
    expect(last()).toMatchObject({ url: "/api/rename", body: { path: "a.tspec.yaml", newPath: "b.tspec.yaml" } });

    await api.deletePath("a.tspec.yaml");
    expect(last().url).toBe("/api/delete");

    await api.duplicatePath("a.tspec.yaml", "c.tspec.yaml");
    expect(last().url).toBe("/api/duplicate");

    await api.saveEnvironment("local", { baseUrl: "x" }, ["token"]);
    expect(last()).toMatchObject({
      url: "/api/environment",
      body: { name: "local", variables: { baseUrl: "x" }, secrets: ["token"] },
    });

    await api.saveFolderConfig("api", { baseUrl: "x" });
    expect(last().url).toBe("/api/folder/object");
  });

  it("posts the analysis and mock routes", async () => {
    await api.drift("openapi.yaml");
    expect(last()).toMatchObject({ url: "/api/drift", body: { spec: "openapi.yaml" } });

    await api.coverage("openapi.yaml");
    expect(last().url).toBe("/api/coverage");

    await api.exportPostman("api");
    expect(last()).toMatchObject({ url: "/api/export/postman", body: { path: "api" } });

    await api.getFlow();
    expect(last().url).toBe("/api/flow");

    await api.getFolderConfig("api");
    expect(last().url).toBe("/api/folder?path=api");

    await api.mockStatus();
    expect(last().url).toBe("/api/mock/status");

    await api.mockStart("openapi.yaml", 4000, 50);
    expect(last()).toMatchObject({ url: "/api/mock/start", body: { spec: "openapi.yaml", port: 4000, delayMs: 50 } });

    await api.mockStop();
    expect(last()).toMatchObject({ url: "/api/mock/stop", method: "POST" });

    await api.mockLog();
    expect(last().url).toBe("/api/mock/log");
  });
});
