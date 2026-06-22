import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contractTool,
  coverageTool,
  createRequest,
  driftTool,
  listCollections,
  runRequestTool,
  scaffoldFromSpec,
  updateRequest,
} from "../src/tools";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

describe("mcp tools", () => {
  it("lists collections", () => {
    const r = listCollections({ cwd: repoRoot }, "examples/petstore");
    expect(r.count).toBe(1);
    expect(r.requests[0]?.name).toBe("Get pet by id");
  });

  it("creates and updates a request, validating before writing", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-mcp-"));
    try {
      const ctx = { cwd: dir };
      expect(createRequest(ctx, "r.tspec.yaml", { name: "x" }).ok).toBe(false); // missing url

      expect(createRequest(ctx, "r.tspec.yaml", { name: "Get", method: "GET", url: "http://x/{{id}}" }).ok).toBe(true);
      expect(updateRequest(ctx, "r.tspec.yaml", { method: "POST" }).ok).toBe(true);
      expect(readFileSync(join(dir, "r.tspec.yaml"), "utf8")).toMatch(/method: POST/);

      expect(updateRequest(ctx, "r.tspec.yaml", { method: "WRONG" }).ok).toBe(false); // invalid enum
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects paths that escape the workspace", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-esc-"));
    try {
      const ctx = { cwd: dir };
      // writes outside the workspace are blocked
      expect(() => createRequest(ctx, "../escape.tspec.yaml", { name: "X", url: "http://x" })).toThrow(/escapes/);
      expect(() => updateRequest(ctx, "../../etc/x", {})).toThrow(/escapes/);
      expect(() =>
        scaffoldFromSpec(ctx, resolve(repoRoot, "examples/petstore/openapi.yaml"), "../out"),
      ).toThrow(/escapes/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports drift and coverage", async () => {
    const ctx = { cwd: repoRoot };
    const drift = await driftTool(ctx, "examples/petstore", "examples/petstore/openapi.yaml");
    expect(drift.added).toContain("GET /pets");
    expect(coverageTool(ctx, "examples/petstore", "examples/petstore/openapi.yaml").percent).toBe(33);
  });

  it("validates responses against the spec (contract)", async () => {
    const fetchMock = (async () =>
      new Response(JSON.stringify({ id: "not-an-int", name: "Rex" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const prev = process.env.token;
    process.env.token = "x"; // the petstore folder requires bearer auth — supply the secret
    try {
      const report = await contractTool(
        { cwd: repoRoot, fetch: fetchMock },
        "examples/petstore",
        "examples/petstore/openapi.yaml",
        "local",
      );
      expect(report.ok).toBe(false);
      expect(report.violations[0]?.op).toBe("GET /pets/{id}");
      expect(report.untested).toContain("GET /pets");
    } finally {
      if (prev === undefined) delete process.env.token;
      else process.env.token = prev;
    }
  });

  it("scaffolds requests from a spec", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-scaffold-"));
    try {
      const r = scaffoldFromSpec({ cwd: dir }, resolve(repoRoot, "examples/petstore/openapi.yaml"), "api");
      expect(r.created).toBe(3);
      expect(readFileSync(join(dir, "api", "getpetbyid.tspec.yaml"), "utf8")).toMatch(
        /\{\{baseUrl\}\}\/pets\/\{\{id\}\}/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs a request with an injected fetch", async () => {
    const fetchMock = (async () =>
      new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const result = await runRequestTool(
      { cwd: repoRoot, fetch: fetchMock },
      "examples/petstore/get-pet.tspec.yaml",
    );
    expect(result.results.length).toBe(1);
  });
});
