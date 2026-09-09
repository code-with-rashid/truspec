import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  codegenTargetsTool,
  codegenTool,
  docsTool,
  environmentsTool,
  importCurlTool,
  importHarTool,
  importInsomniaTool,
  lintTool,
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

  it("a malformed file does not abort the listing — valid requests still list, bad files reported with path", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-mcp-bad-"));
    try {
      writeFileSync(join(dir, "good.tspec.yaml"), 'tspec: "0.1"\nname: Good\nmethod: GET\nurl: "http://x"\nassertions: []\n');
      writeFileSync(join(dir, "bad.tspec.yaml"), "this: is: not: valid\n[}");
      const r = listCollections({ cwd: dir });
      expect(r.count).toBe(1); // the good one still lists
      expect(r.requests[0]?.name).toBe("Good");
      expect(r.errors?.length).toBe(1); // the bad one is reported, not silently dropped
      expect(r.errors?.[0]?.path).toBe("bad.tspec.yaml"); // …and names the offending file
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it("imports a curl command into request files", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-mcp-curl-"));
    try {
      const r = importCurlTool({ cwd: dir }, `curl -X POST https://api.example.com/pets -d '{"name":"Rex"}'`) as {
        created: number;
        files: string[];
      };
      expect(r.created).toBe(1);
      expect(readFileSync(join(dir, r.files[0]!), "utf8")).toContain("Rex");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a curl import that produced nothing rather than writing files", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-mcp-curl-bad-"));
    try {
      const r = importCurlTool({ cwd: dir }, "nothing here") as { created: number; warnings: string[] };
      expect(r.created).toBe(0);
      expect(r.warnings.join(" ")).toMatch(/No curl command/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("generates a code snippet with folder + environment context applied", () => {
    const r = codegenTool({ cwd: repoRoot }, "examples/petstore/get-pet.tspec.yaml", "python-requests", "local") as {
      lang: string;
      code: string;
      unresolvedSecrets?: string[];
    };
    expect(r.lang).toBe("python-requests");
    expect(r.code).toContain("import requests");
    expect(r.code).toContain("http://localhost:4000/pets/1");
    // `token` is a declared secret with no value in this process — reported, not silently dropped.
    expect(r.unresolvedSecrets).toContain("token");
  });

  it("returns the target list instead of throwing on an unknown lang", () => {
    const r = codegenTool({ cwd: repoRoot }, "examples/petstore/get-pet.tspec.yaml", "cobol") as {
      error: string;
      targets: Array<{ id: string }>;
    };
    expect(r.error).toMatch(/Unknown lang/);
    expect(r.targets.map((t) => t.id)).toContain("curl");
  });

  it("lists every codegen target", () => {
    const r = codegenTargetsTool();
    expect(r.count).toBe(r.targets.length);
    expect(r.count).toBeGreaterThanOrEqual(17);
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

  it("describes environments without ever returning a secret's value", () => {
    const r = environmentsTool({ cwd: resolve(repoRoot, "examples/petstore") }) as {
      environments: Array<{ name: string; secrets: Array<{ name: string; resolved: boolean }> }>;
    };
    expect(r.environments.map((e) => e.name)).toEqual(["local"]);
    expect(r.environments[0]!.secrets[0]!.name).toBe("token");
    expect(JSON.stringify(r)).not.toMatch(/"value"/);
  });

  it("diffs two environments and names the ones it knows when asked for a missing one", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-mcp-env-"));
    try {
      mkdirSync(join(dir, "environments"), { recursive: true });
      writeFileSync(join(dir, "environments", "a.env.yaml"), 'tspec: "0.1"\nname: a\nvariables: { x: "1", only: "a" }\n');
      writeFileSync(join(dir, "environments", "b.env.yaml"), 'tspec: "0.1"\nname: b\nvariables: { x: "2" }\n');
      const d = environmentsTool({ cwd: dir }, ".", ["a", "b"]) as { onlyInA: string[]; changed: unknown[] };
      expect(d.onlyInA).toEqual(["only"]);
      expect(d.changed).toEqual([{ name: "x", a: "1", b: "2" }]);

      const missing = environmentsTool({ cwd: dir }, ".", ["a", "nope"]) as { error: string; known: string[] };
      expect(missing.error).toMatch(/Environment not found: nope/);
      expect(missing.known).toEqual(["a", "b"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders documentation for a collection", () => {
    const r = docsTool({ cwd: repoRoot }, "examples/blog", "curl", "Blog") as {
      count: number;
      markdown: string;
    };
    expect(r.count).toBe(3);
    expect(r.markdown.startsWith("# Blog")).toBe(true);
  });

  it("lints a collection and reports findings with stable rule ids", () => {
    const r = lintTool({ cwd: repoRoot }, "examples") as { ok: boolean; findings: unknown[] };
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it("honors a disabled rule", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-mcp-lint-"));
    try {
      writeFileSync(join(dir, "x.tspec.yaml"), 'tspec: "0.1"\nname: X\nurl: "https://x.test/a"\n');
      expect((lintTool({ cwd: dir }, ".") as { findings: unknown[] }).findings.length).toBe(1);
      expect((lintTool({ cwd: dir }, ".", ["no-assertions"]) as { findings: unknown[] }).findings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("imports an Insomnia export into request files", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-mcp-insomnia-"));
    try {
      writeFileSync(
        join(dir, "e.json"),
        JSON.stringify({
          resources: [
            { _id: "w", _type: "workspace", name: "W" },
            { _id: "r", _type: "request", parentId: "w", name: "Get pet", method: "GET", url: "https://api.test/pets", headers: [] },
          ],
        }),
      );
      const r = importInsomniaTool({ cwd: dir }, "e.json", "api") as { created: number; files: string[] };
      expect(r.created).toBe(1);
      expect(readFileSync(join(dir, r.files[0]!), "utf8")).toContain("https://api.test/pets");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("imports a HAR file into request files", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-mcp-har-"));
    try {
      writeFileSync(
        join(dir, "s.har"),
        JSON.stringify({
          log: { entries: [{ request: { method: "GET", url: "https://api.test/pets", headers: [] }, response: { status: 200 } }] },
        }),
      );
      const r = importHarTool({ cwd: dir }, "s.har", "api", undefined, "baseUrl") as {
        created: number;
        files: string[];
      };
      expect(r.created).toBe(1);
      expect(readFileSync(join(dir, r.files[0]!), "utf8")).toContain("{{baseUrl}}/pets");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a HAR with nothing importable rather than writing files", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-mcp-har-empty-"));
    try {
      writeFileSync(join(dir, "s.har"), JSON.stringify({ log: { entries: [] } }));
      const r = importHarTool({ cwd: dir }, "s.har") as { created: number; warnings: string[] };
      expect(r.created).toBe(0);
      expect(r.warnings.join(" ")).toMatch(/No importable entries/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
