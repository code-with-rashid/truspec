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

  it("reports each environment's secret resolution status, and never a secret's value", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-env-"));
    try {
      mkdirSync(join(dir, "environments"), { recursive: true });
      writeFileSync(
        join(dir, "environments", "local.env.yaml"),
        'tspec: "0.1"\nname: local\nvariables: { baseUrl: "http://localhost:4000" }\nsecrets: [webApiTestToken, webApiTestMissing]\n',
      );
      writeFileSync(join(dir, ".env"), "webApiTestToken=do-not-leak-me\n");
      const r = await handleApi("GET", "/api/environments", noQuery, undefined, { dir });
      expect(r.status).toBe(200);
      const out = r.json as {
        environments: { name: string; secrets: { name: string; resolved: boolean; source?: string }[]; unresolved: string[] }[];
      };
      const env = out.environments[0]!;
      expect(env.name).toBe("local");
      expect(env.secrets).toEqual([
        { name: "webApiTestToken", resolved: true, source: "dotenv" },
        { name: "webApiTestMissing", resolved: false },
      ]);
      expect(env.unresolved).toEqual(["webApiTestMissing"]);
      // The whole point of the status-only shape: this response reaches a browser.
      expect(JSON.stringify(out)).not.toContain("do-not-leak-me");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("imports a pasted curl command into the workspace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-curl-"));
    try {
      const r = await handleApi(
        "POST",
        "/api/import/curl",
        noQuery,
        { text: `curl 'https://api.example.com/pets' -H 'Authorization: Bearer t0k'` },
        { dir },
      );
      const out = r.json as { ok: boolean; stats: { requests: number }; files: string[] };
      expect(out.ok).toBe(true);
      expect(out.stats.requests).toBe(1);
      const written = readFileSync(join(dir, out.files[0]!), "utf8");
      expect(written).toContain("type: bearer");
      expect(written).toContain("token: t0k");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports unusable curl input instead of writing an empty import", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-curl-bad-"));
    try {
      const empty = await handleApi("POST", "/api/import/curl", noQuery, { text: "   " }, { dir });
      expect(empty.status).toBe(400);
      const junk = await handleApi("POST", "/api/import/curl", noQuery, { text: "hello there" }, { dir });
      expect((junk.json as { ok: boolean }).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("imports a HAR export, stripping browser noise and asserting the recorded status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-har-"));
    try {
      const harDoc = {
        log: {
          entries: [
            {
              request: {
                method: "GET",
                url: "https://api.example.com/pets?page=2",
                headers: [
                  { name: "accept", value: "application/json" },
                  { name: "sec-ch-ua", value: '"Chromium"' },
                ],
              },
              response: { status: 201 },
            },
          ],
        },
      };
      const r = await handleApi("POST", "/api/import/har", noQuery, { json: harDoc }, { dir });
      const out = r.json as { ok: boolean; stats: { requests: number }; files: string[] };
      expect(out.ok).toBe(true);
      expect(out.stats.requests).toBe(1);
      const written = readFileSync(join(dir, out.files[0]!), "utf8");
      expect(written).toContain("equals: 201");
      expect(written).not.toContain("sec-ch-ua");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a non-HAR document rather than writing an empty import", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-har-bad-"));
    try {
      const missing = await handleApi("POST", "/api/import/har", noQuery, {}, { dir });
      expect(missing.status).toBe(400);
      const junk = await handleApi("POST", "/api/import/har", noQuery, { json: { nope: 1 } }, { dir });
      expect((junk.json as { ok: boolean }).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("imports an Insomnia export, reassembling its flat resource list into folders", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-insomnia-"));
    try {
      const doc = {
        resources: [
          { _id: "wrk", _type: "workspace", name: "W" },
          { _id: "grp", _type: "request_group", parentId: "wrk", name: "Pets" },
          {
            _id: "req",
            _type: "request",
            parentId: "grp",
            name: "Get pet",
            method: "GET",
            url: "https://api.test/pets/1",
            headers: [],
          },
        ],
      };
      const r = await handleApi("POST", "/api/import/insomnia", noQuery, { json: doc }, { dir });
      const out = r.json as { ok: boolean; stats: { requests: number }; files: string[] };
      expect(out.ok).toBe(true);
      expect(out.stats.requests).toBe(1);
      expect(out.files[0]).toContain("pets");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a document that is not an Insomnia export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-insomnia-bad-"));
    try {
      const missing = await handleApi("POST", "/api/import/insomnia", noQuery, {}, { dir });
      expect(missing.status).toBe(400);
      const junk = await handleApi("POST", "/api/import/insomnia", noQuery, { json: { nope: 1 } }, { dir });
      expect((junk.json as { ok: boolean; error: string }).ok).toBe(false);
      expect((junk.json as { error: string }).error).toMatch(/Not an Insomnia export/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists code-generation targets", async () => {
    const r = await handleApi("GET", "/api/codegen/targets", noQuery, undefined, ctx);
    const targets = (r.json as { targets: Array<{ id: string }> }).targets;
    expect(targets.length).toBeGreaterThanOrEqual(17);
    expect(targets.map((t) => t.id)).toContain("python-requests");
  });

  it("generates a snippet from a draft request, applying the folder chain and environment", async () => {
    const request = {
      tspec: "0.1",
      name: "Get pet",
      method: "GET",
      url: "{{baseUrl}}/pets/{{petId}}",
      assertions: [],
    };
    const r = await handleApi(
      "POST",
      "/api/codegen",
      noQuery,
      { request, path: "get-pet.tspec.yaml", lang: "curl", env: "local" },
      ctx,
    );
    const out = r.json as { ok: boolean; code: string; syntax: string };
    expect(out.ok).toBe(true);
    expect(out.syntax).toBe("bash");
    // baseUrl/petId come from environments/local.env.yaml; Accept from folder.tspec.yaml.
    expect(out.code).toContain("http://localhost:4000/pets/1");
    expect(out.code).toContain("Accept: application/json");
  });

  it("rejects an unknown codegen language and reports an invalid draft rather than throwing", async () => {
    const bad = await handleApi("POST", "/api/codegen", noQuery, { request: {}, lang: "cobol" }, ctx);
    expect(bad.status).toBe(400);

    const invalid = await handleApi("POST", "/api/codegen", noQuery, { request: { name: "" }, lang: "curl" }, ctx);
    expect(invalid.status).toBe(200);
    expect((invalid.json as { ok: boolean; error: string }).ok).toBe(false);
    expect((invalid.json as { error: string }).error).toBeTruthy();
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

describe("web server api — flow view (GET /api/flow)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "truspec-web-flow-"));
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "folder.tspec.yaml"), 'tspec: "0.1"\nname: root\nbaseUrl: "http://x"\n');
    writeFileSync(
      join(dir, "01-login.tspec.yaml"),
      'tspec: "0.1"\nname: Login\nmethod: POST\nurl: "/login"\norder: 1\ncapture:\n  token: "$.access_token"\nassertions: []\n',
    );
    writeFileSync(
      join(dir, "sub", "02-call.tspec.yaml"),
      'tspec: "0.1"\nname: Call\nmethod: GET\nurl: "/call"\norder: 2\nauth: { type: bearer, token: "{{token}}" }\nassertions: []\n',
    );
    writeFileSync(join(dir, "broken.tspec.yaml"), "this: is: not: valid\n[}");
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns steps in run order with captures/consumes derived from the request (no execution)", async () => {
    const r = await handleApi("GET", "/api/flow", noQuery, undefined, { dir });
    expect(r.status).toBe(200);
    const flow = r.json as { steps: Array<Record<string, unknown>>; errors: Array<{ path: string }> };
    expect(flow.steps.map((s) => s.name)).toEqual(["Login", "Call"]);
    expect(flow.steps[0]).toMatchObject({ order: 1, captures: ["token"], consumes: [] });
    // "Call" only sets auth (no relative-URL baseUrl join happens without a leading folder check
    // failing), and its bearer token references {{token}} — the exact var `Login` captures.
    expect(flow.steps[1]).toMatchObject({ order: 2, captures: [], consumes: ["token"] });
    expect(flow.errors.map((e) => e.path)).toContain("broken.tspec.yaml");
  });
});

describe("web server api — import from the UI", () => {
  const imports = resolve(repoRoot, "examples", "imports");

  it("POST /api/import/postman converts and writes a collection into the workspace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-import-pm-"));
    try {
      const json = JSON.parse(readFileSync(join(imports, "postman-collection.json"), "utf8"));
      const r = await handleApi("POST", "/api/import/postman", noQuery, { json, targetDir: "imported" }, { dir });
      const body = r.json as { ok: boolean; stats: { requests: number }; files: string[] };
      expect(body.ok).toBe(true);
      expect(body.stats.requests).toBeGreaterThan(0);
      for (const f of body.files) expect(existsSync(join(dir, "imported", f))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("POST /api/import/postman reports a graceful error for a non-collection JSON body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-import-pm-bad-"));
    try {
      const r = await handleApi("POST", "/api/import/postman", noQuery, { json: { not: "a collection" } }, { dir });
      expect(r.status).toBe(200);
      expect((r.json as { ok: boolean }).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("POST /api/import/bruno converts uploaded file contents (no real directory) and writes them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-import-bru-"));
    try {
      const content = readFileSync(join(imports, "bruno", "get-user.bru"), "utf8");
      const r = await handleApi(
        "POST",
        "/api/import/bruno",
        noQuery,
        { files: [{ path: "users/get-user.bru", content }], targetDir: "imported" },
        { dir },
      );
      const body = r.json as { ok: boolean; stats: { requests: number }; files: string[] };
      expect(body.ok).toBe(true);
      expect(body.stats.requests).toBe(1);
      expect(body.files.map((p) => p.replace(/\\/g, "/"))).toEqual(["users/get-user.tspec.yaml"]);
      expect(existsSync(join(dir, "imported", "users", "get-user.tspec.yaml"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("POST /api/import/bruno refuses a client-supplied path that escapes the workspace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-import-bru-escape-"));
    try {
      const content = readFileSync(join(imports, "bruno", "get-user.bru"), "utf8");
      const r = await handleApi(
        "POST",
        "/api/import/bruno",
        noQuery,
        { files: [{ path: "../../evil.bru", content }] },
        { dir },
      );
      const body = r.json as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/escapes/);
      expect(existsSync(join(dir, "..", "..", "evil.tspec.yaml"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("POST /api/import/bruno rejects a request with no files", async () => {
    const r = await handleApi("POST", "/api/import/bruno", noQuery, { files: [] }, { dir: ctx.dir });
    expect(r.status).toBe(400);
  });
});

describe("web server api — configured transport", () => {
  it("sends outbound requests through the transport `serve` was configured with", async () => {
    // Proves the plumbing that lets the UI reach a self-signed or proxied host the CLI can reach.
    // Without it the same collection passes in CI and fails in the browser, unexplained.
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-transport-"));
    try {
      writeFileSync(
        join(dir, "get.tspec.yaml"),
        'tspec: "0.1"\nname: Get pet\nmethod: GET\nurl: "https://unreachable.invalid/pets/1"\nassertions: [ { type: status, equals: 418 } ]\n',
      );
      const seen: string[] = [];
      const stub: typeof globalThis.fetch = (input) => {
        seen.push(String(input));
        return Promise.resolve(new Response("{}", { status: 418, headers: { "content-type": "application/json" } }));
      };
      const r = await handleApi("POST", "/api/run", noQuery, { target: "get.tspec.yaml" }, { dir, fetch: stub });
      const out = r.json as { results: Array<{ ok: boolean; response?: { status: number } }> };
      expect(seen).toEqual(["https://unreachable.invalid/pets/1"]);
      expect(out.results[0].response?.status).toBe(418);
      expect(out.results[0].ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explains a connection failure instead of reporting `fetch failed`", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-refused-"));
    try {
      // Bind an ephemeral port and close it again: now we know a port nothing is listening on.
      const dead = createServer();
      await new Promise<void>((r) => dead.listen(0, "127.0.0.1", () => r()));
      const deadPort = (dead.address() as { port: number }).port;
      await new Promise((r) => dead.close(() => r(undefined)));
      writeFileSync(
        join(dir, "get.tspec.yaml"),
        `tspec: "0.1"\nname: Get pet\nmethod: GET\nurl: "http://127.0.0.1:${deadPort}/pets/1"\nassertions: [ { type: status, equals: 200 } ]\n`,
      );
      const r = await handleApi("POST", "/api/run", noQuery, { target: "get.tspec.yaml" }, { dir });
      const out = r.json as { results: Array<{ ok: boolean; error?: string }> };
      expect(out.results[0].ok).toBe(false);
      expect(out.results[0].error).toMatch(new RegExp(`Connection refused by 127\\.0\\.0\\.1:${deadPort}`));
      expect(out.results[0].error).not.toMatch(/fetch failed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
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

describe("a save that would overwrite an edit made on disk", () => {
  const REQ = 'tspec: "0.1"\nname: R\nmethod: GET\nurl: "http://x/y"\nassertions: []\n';
  const setup = (): { dir: string; file: string } => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-web-conflict-"));
    const file = join(dir, "r.tspec.yaml");
    writeFileSync(file, REQ);
    return { dir, file };
  };

  it("hands out a version with the file, and takes it back on save", async () => {
    const { dir, file } = setup();
    try {
      const read = await handleApi("GET", "/api/request", new URLSearchParams({ path: "r.tspec.yaml" }), undefined, { dir });
      const { version } = read.json as { version: string };
      expect(version).toMatch(/^[0-9a-f]{16}$/);

      const ok = await handleApi("POST", "/api/request", noQuery, { path: "r.tspec.yaml", content: REQ.replace("GET", "PUT"), baseVersion: version }, { dir });
      expect((ok.json as { ok: boolean }).ok).toBe(true);
      expect(readFileSync(file, "utf8")).toContain("method: PUT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses it, and returns what is on disk instead of writing", async () => {
    const { dir, file } = setup();
    try {
      const read = await handleApi("GET", "/api/request", new URLSearchParams({ path: "r.tspec.yaml" }), undefined, { dir });
      const { version } = read.json as { version: string };
      writeFileSync(file, `${REQ}docs: "someone else"\n`);

      const r = await handleApi("POST", "/api/request", noQuery, { path: "r.tspec.yaml", content: REQ.replace("GET", "PUT"), baseVersion: version }, { dir });
      const body = r.json as { ok: boolean; conflict: boolean; current: string };
      expect(body.ok).toBe(false);
      expect(body.conflict).toBe(true);
      expect(body.current).toContain("someone else");
      expect(readFileSync(file, "utf8")).toContain("someone else"); // nothing written
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a structured save the same way", async () => {
    const { dir, file } = setup();
    try {
      const read = await handleApi("GET", "/api/request", new URLSearchParams({ path: "r.tspec.yaml" }), undefined, { dir });
      const { version } = read.json as { version: string };
      writeFileSync(file, `${REQ}docs: "someone else"\n`);

      const r = await handleApi("POST", "/api/request/object", noQuery, {
        path: "r.tspec.yaml",
        request: { tspec: "0.1", name: "R", method: "PUT", url: "http://x/y", assertions: [] },
        baseVersion: version,
      }, { dir });
      expect((r.json as { conflict: boolean }).conflict).toBe(true);
      expect(readFileSync(file, "utf8")).toContain("someone else");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes without a version — an overwrite the user asked for, and any other client", async () => {
    const { dir, file } = setup();
    try {
      writeFileSync(file, `${REQ}docs: "someone else"\n`);
      const r = await handleApi("POST", "/api/request", noQuery, { path: "r.tspec.yaml", content: REQ.replace("GET", "PUT") }, { dir });
      expect((r.json as { ok: boolean }).ok).toBe(true);
      expect(readFileSync(file, "utf8")).not.toContain("someone else");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
