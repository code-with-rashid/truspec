import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildVars, discoverRequests, mergeFolderConfigs, runPath } from "../src/workspace";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const petstore = resolve(repoRoot, "examples", "petstore");

describe("workspace discovery", () => {
  it("finds request files but not folder configs", () => {
    const files = discoverRequests(petstore);
    expect(files.some((f) => f.endsWith("get-pet.tspec.yaml"))).toBe(true);
    expect(files.some((f) => f.endsWith("folder.tspec.yaml"))).toBe(false);
  });

  it("terminates on a symlink cycle instead of recursing forever", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-ws-"));
    try {
      mkdirSync(join(dir, "sub"));
      writeFileSync(join(dir, "sub", "a.tspec.yaml"), "name: a\nurl: http://x");
      symlinkSync(dir, join(dir, "sub", "loop")); // sub/loop -> dir  (cycle)
      const files = discoverRequests(dir);
      expect(files.filter((f) => f.endsWith("a.tspec.yaml")).length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not follow a symlink that points outside the workspace", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-ws-"));
    const outside = mkdtempSync(join(tmpdir(), "truspec-out-"));
    try {
      writeFileSync(join(outside, "foreign.tspec.yaml"), "name: x\nurl: http://x");
      symlinkSync(outside, join(dir, "escape")); // dir/escape -> outside
      const files = discoverRequests(dir);
      expect(files.some((f) => f.endsWith("foreign.tspec.yaml"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("mergeFolderConfigs", () => {
  it("merges with deeper entries winning", () => {
    const merged = mergeFolderConfigs([
      { tspec: "0.1", baseUrl: "https://root", headers: { A: "1" } },
      { tspec: "0.1", headers: { A: "2", B: "3" } },
    ]);
    expect(merged.baseUrl).toBe("https://root");
    expect(merged.headers).toEqual({ A: "2", B: "3" });
  });
});

describe("buildVars", () => {
  it("resolves secrets from process env and reports missing", () => {
    const { vars, missingSecrets } = buildVars(
      { tspec: "0.1", name: "x", variables: { a: "1" }, secrets: ["TOK", "MISSING"] },
      { TOK: "v" },
    );
    expect(vars).toEqual({ a: "1", TOK: "v" });
    expect(missingSecrets).toEqual(["MISSING"]);
  });
});

describe("runPath", () => {
  it("runs the petstore example end to end with injected fetch", async () => {
    let t = 0;
    const result = await runPath("examples/petstore", {
      env: "local",
      cwd: repoRoot,
      processEnv: { token: "secret" },
      now: () => (t += 5),
      fetch: (async (url: string | URL | Request) => {
        expect(String(url)).toContain("/pets/1");
        return new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(result.passed).toBe(1);
  });

  it("throws on a missing environment", async () => {
    await expect(runPath("examples/petstore", { env: "nope", cwd: repoRoot })).rejects.toThrow(/not found/);
  });
});
