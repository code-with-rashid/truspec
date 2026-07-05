import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiContext, handleApi } from "../server/api";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const ctx = { dir: resolve(repoRoot, "examples", "petstore") };
const noQuery = new URLSearchParams();

describe("web server api", () => {
  it("lists collection state (requests, specs, environments)", async () => {
    const r = await handleApi("GET", "/api/state", noQuery, undefined, ctx);
    const s = r.json as { requests: unknown[]; specs: string[]; environments: string[] };
    expect(s.requests.length).toBe(1);
    expect(s.specs).toContain("openapi.yaml");
    expect(s.environments).toContain("local");
  });

  it("a malformed request file does not 500 /api/state — valid requests load, bad files reported", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-state-"));
    try {
      writeFileSync(join(dir, "good.tspec.yaml"), 'tspec: "0.1"\nname: Good\nmethod: GET\nurl: "http://x"\nassertions: []\n');
      writeFileSync(join(dir, "broken.tspec.yaml"), "this: is: not: valid\n[}");
      const r = await handleApi("GET", "/api/state", noQuery, undefined, { dir });
      expect(r.status).toBe(200); // pre-fix: parse threw → 500, the UI couldn't load at all
      const s = r.json as { requests: { name: string }[]; errors: { path: string }[] };
      expect(s.requests.length).toBe(1);
      expect(s.requests[0].name).toBe("Good");
      expect(s.errors.map((e) => e.path)).toContain("broken.tspec.yaml");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("computes drift and coverage", async () => {
    const drift = await handleApi("POST", "/api/drift", noQuery, { spec: "openapi.yaml" }, ctx);
    expect((drift.json as { added: string[] }).added).toContain("GET /pets");

    const cov = await handleApi("POST", "/api/coverage", noQuery, { spec: "openapi.yaml" }, ctx);
    expect((cov.json as { percent: number }).percent).toBe(33);
  });

  it("reads a single request (parsed fields + raw source)", async () => {
    const r = await handleApi(
      "GET",
      "/api/request",
      new URLSearchParams({ path: "get-pet.tspec.yaml" }),
      undefined,
      ctx,
    );
    const json = r.json as { name: string; raw: string };
    expect(json.name).toBe("Get pet by id");
    expect(json.raw).toContain("name:"); // raw YAML for the editor
  });

  it("rejects path escapes and unknown routes", async () => {
    await expect(
      handleApi("GET", "/api/request", new URLSearchParams({ path: "../../etc/passwd" }), undefined, ctx),
    ).rejects.toThrow(/escapes/);
    expect((await handleApi("GET", "/api/nope", noQuery, undefined, ctx)).status).toBe(404);
  });
});

describe("web server api — save request (in-UI editing)", () => {
  let dir: string;
  let wctx: { dir: string };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "truspec-web-save-"));
    wctx = { dir };
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const valid = 'name: Made in UI\nmethod: POST\nurl: "http://x/y"\nassertions:\n  - { type: status, equals: 201 }\n';

  it("creates a new request file (confined + validated) and round-trips it", async () => {
    const r = await handleApi("POST", "/api/request", noQuery, { path: "sub/new.tspec.yaml", content: valid }, wctx);
    expect((r.json as { ok: boolean }).ok).toBe(true);
    expect(existsSync(join(dir, "sub", "new.tspec.yaml"))).toBe(true);
    expect(readFileSync(join(dir, "sub", "new.tspec.yaml"), "utf8")).toBe(valid);

    const got = await handleApi("GET", "/api/request", new URLSearchParams({ path: "sub/new.tspec.yaml" }), undefined, wctx);
    expect((got.json as { name: string }).name).toBe("Made in UI");
  });

  it("rejects invalid content without writing, returning the schema error", async () => {
    const r = await handleApi("POST", "/api/request", noQuery, { path: "bad.tspec.yaml", content: "method: NOPE\n" }, wctx);
    const json = r.json as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toBeTruthy();
    expect(existsSync(join(dir, "bad.tspec.yaml"))).toBe(false);
  });

  it("rejects a non-.tspec.yaml path", async () => {
    const r = await handleApi("POST", "/api/request", noQuery, { path: "notes.txt", content: valid }, wctx);
    expect((r.json as { ok: boolean }).ok).toBe(false);
    expect(existsSync(join(dir, "notes.txt"))).toBe(false);
  });

  it("refuses to write outside the workspace", async () => {
    const r = await handleApi("POST", "/api/request", noQuery, { path: "../escape.tspec.yaml", content: valid }, wctx);
    const json = r.json as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/escapes/);
  });

  it("handles concurrent saves to the same path without corrupting the file", async () => {
    const writes = Array.from({ length: 30 }, (_, i) =>
      handleApi("POST", "/api/request", noQuery, { path: "race.tspec.yaml", content: `name: Race${i}\nurl: http://x/y\n` }, wctx),
    );
    const results = await Promise.all(writes);
    expect(results.every((r) => (r.json as { ok: boolean }).ok)).toBe(true);
    // a complete write won — the file still parses (no interleaved/partial content)
    const got = await handleApi("GET", "/api/request", new URLSearchParams({ path: "race.tspec.yaml" }), undefined, wctx);
    expect((got.json as { name: string }).name).toMatch(/^Race\d+$/);
  });
});

describe("web server api — mock server control", () => {
  it("rejects starting the mock server without a spec", async () => {
    const r = await handleApi("POST", "/api/mock/start", noQuery, {}, { dir: ctx.dir });
    expect(r.status).toBe(400);
  });

  it("starts, logs requests, reports status, and stops", async () => {
    const mctx: ApiContext = { dir: ctx.dir };
    const start = await handleApi("POST", "/api/mock/start", noQuery, { spec: "openapi.yaml", port: 0 }, mctx);
    const startJson = start.json as { ok: boolean; running: boolean; url: string; routes: number };
    try {
      expect(startJson.ok).toBe(true);
      expect(startJson.running).toBe(true);
      expect(startJson.routes).toBe(3);

      const status = await handleApi("GET", "/api/mock/status", noQuery, undefined, mctx);
      expect((status.json as { running: boolean }).running).toBe(true);

      await fetch(`${startJson.url}/pets/1`);
      const log = await handleApi("GET", "/api/mock/log", noQuery, undefined, mctx);
      const entries = (log.json as { log: Array<{ method: string; path: string; status: number }> }).log;
      expect(entries[0]).toMatchObject({ method: "GET", path: "/pets/1", status: 200 });
    } finally {
      const stop = await handleApi("POST", "/api/mock/stop", noQuery, undefined, mctx);
      expect((stop.json as { ok: boolean }).ok).toBe(true);
    }
    const status = await handleApi("GET", "/api/mock/status", noQuery, undefined, mctx);
    expect((status.json as { running: boolean }).running).toBe(false);
  });

  it("starting again on the same context closes the previous server", async () => {
    const mctx: ApiContext = { dir: ctx.dir };
    const first = await handleApi("POST", "/api/mock/start", noQuery, { spec: "openapi.yaml", port: 0 }, mctx);
    const firstUrl = (first.json as { url: string }).url;
    try {
      const second = await handleApi("POST", "/api/mock/start", noQuery, { spec: "openapi.yaml", port: 0 }, mctx);
      expect((second.json as { ok: boolean }).ok).toBe(true);
      await expect(fetch(firstUrl, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
    } finally {
      await handleApi("POST", "/api/mock/stop", noQuery, undefined, mctx);
    }
  });
});

describe("web server api — spec-aware run (contract validation)", () => {
  it("passing spec to /api/run auto-validates a spec-linked request's response", async () => {
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: 1, name: "Rex", tag: "dog" }));
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
    const port = (upstream.address() as { port: number }).port;
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-contract-"));
    try {
      mkdirSync(join(dir, "environments"), { recursive: true });
      writeFileSync(
        join(dir, "environments", "local.env.yaml"),
        `tspec: "0.1"\nname: local\nvariables: { baseUrl: "http://127.0.0.1:${port}" }\n`,
      );
      writeFileSync(join(dir, "openapi.yaml"), readFileSync(join(ctx.dir, "openapi.yaml"), "utf8"));
      writeFileSync(
        join(dir, "get.tspec.yaml"),
        'tspec: "0.1"\nname: Get pet\nmethod: GET\nurl: "{{baseUrl}}/pets/1"\nspec: { operation: "GET /pets/{id}" }\nassertions: [ { type: status, equals: 200 } ]\n',
      );

      const withoutSpec = await handleApi("POST", "/api/run", noQuery, { target: "get.tspec.yaml", env: "local" }, { dir });
      const withoutJson = withoutSpec.json as { results: Array<{ assertions: Array<{ type: string }> }> };
      expect(withoutJson.results[0].assertions.some((a) => a.type === "schema")).toBe(false);

      const withSpec = await handleApi(
        "POST",
        "/api/run",
        noQuery,
        { target: "get.tspec.yaml", env: "local", spec: "openapi.yaml" },
        { dir },
      );
      const withJson = withSpec.json as { results: Array<{ assertions: Array<{ type: string; ok: boolean; message: string }> }> };
      const schemaAssertion = withJson.results[0].assertions.find((a) => a.type === "schema");
      expect(schemaAssertion?.ok).toBe(true);
      expect(schemaAssertion?.message).toMatch(/conforms/);
    } finally {
      await new Promise((r) => upstream.close(() => r(undefined)));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
