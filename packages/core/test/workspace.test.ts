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

  it("redacts declared secret values from the reported result (e.g. apikey-in-query)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-redact-"));
    try {
      mkdirSync(join(dir, "environments"));
      writeFileSync(
        join(dir, "environments", "local.env.yaml"),
        'tspec: "0.1"\nname: local\nvariables:\n  baseUrl: http://api.test\nsecrets: [API_SECRET]\n',
      );
      writeFileSync(
        join(dir, "get.tspec.yaml"),
        'name: get\nurl: "{{baseUrl}}/data"\nauth: { type: apikey, name: api_key, value: "{{API_SECRET}}", in: query }\n',
      );
      // base64-style value: URLSearchParams percent-encodes +/=, so both forms must be scrubbed.
      const secret = "aB3+x/Yz=token9876";
      const result = await runPath(dir, {
        env: "local",
        cwd: dir,
        processEnv: { API_SECRET: secret },
        fetch: (async () => new Response("{}", { status: 200 })) as typeof fetch,
      });
      expect(result.results[0]?.request.url).toContain("api_key=***");
      const json = JSON.stringify(result);
      expect(json).not.toContain(secret); // raw form
      expect(json).not.toContain(encodeURIComponent(secret)); // percent-encoded form
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not leak a pre-request script's variable into the next request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-iso-"));
    try {
      // A sets `leak` in its pre-script; B (runs after, no script) references {{leak}}.
      writeFileSync(
        join(dir, "a.tspec.yaml"),
        'name: A\norder: 1\nurl: http://x/a\nscript: { pre: "tr.set(\\"leak\\", \\"FROM_A\\")" }',
      );
      writeFileSync(join(dir, "b.tspec.yaml"), 'name: B\norder: 2\nurl: "http://x/{{leak}}"');
      const result = await runPath(dir, {
        cwd: dir,
        fetch: (async () => new Response("{}", { status: 200 })) as typeof fetch,
      });
      const b = result.results.find((r) => r.name === "B");
      expect(b?.ok).toBe(false); // {{leak}} must be unresolved — A's pre-var stays scoped to A
      expect(b?.error).toMatch(/Unresolved/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies a default request timeout that timeoutMs:0 disables", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-timeout-"));
    try {
      writeFileSync(join(dir, "r.tspec.yaml"), "name: r\nurl: http://api.test/x\n");
      let sawSignal: unknown;
      const fetchSpy = (async (_url: unknown, init?: { signal?: unknown }) => {
        sawSignal = init?.signal;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch;
      await runPath(dir, { cwd: dir, fetch: fetchSpy });
      expect(sawSignal).toBeInstanceOf(AbortSignal); // default timeout applied
      await runPath(dir, { cwd: dir, fetch: fetchSpy, timeoutMs: 0 });
      expect(sawSignal).toBeUndefined(); // explicit 0 disables it
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
