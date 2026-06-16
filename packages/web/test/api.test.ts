import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
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

  it("reads a single request", async () => {
    const r = await handleApi(
      "GET",
      "/api/request",
      new URLSearchParams({ path: "get-pet.tspec.yaml" }),
      undefined,
      ctx,
    );
    expect((r.json as { name: string }).name).toBe("Get pet by id");
  });

  it("rejects path escapes and unknown routes", async () => {
    await expect(
      handleApi("GET", "/api/request", new URLSearchParams({ path: "../../etc/passwd" }), undefined, ctx),
    ).rejects.toThrow(/escapes/);
    expect((await handleApi("GET", "/api/nope", noQuery, undefined, ctx)).status).toBe(404);
  });
});
