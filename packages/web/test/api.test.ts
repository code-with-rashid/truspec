import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleApi } from "../server/api";

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
});
