import { resolve } from "node:path";
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
