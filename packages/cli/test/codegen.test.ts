import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { codegenCommand } from "../src/commands/codegen";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const PETSTORE = "examples/petstore/get-pet.tspec.yaml";

function capture() {
  let out = "";
  let err = "";
  return {
    stdout: (s: string) => {
      out += s;
    },
    stderr: (s: string) => {
      err += s;
    },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

async function run(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const cap = capture();
  const code = await codegenCommand(argv, {
    cwd: repoRoot,
    processEnv: env,
    stdout: cap.stdout,
    stderr: cap.stderr,
  });
  return { code, out: cap.out, err: cap.err };
}

describe("truspec codegen", () => {
  it("defaults to curl and applies the folder chain's base URL, headers and auth", async () => {
    const r = await run([PETSTORE, "--env", "local"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("curl -X GET");
    expect(r.out).toContain("http://localhost:4000/pets/1?expand=owner");
    expect(r.out).toContain("-H 'Accept: application/json'");
  });

  // Changed deliberately: this used to assert the resolved secret appeared in the snippet, which
  // is the leak `secret-leak.test.ts` documents. A snippet is made to be shared, so a declared
  // secret now keeps its placeholder unless `--with-secrets` asks otherwise.
  it("keeps a declared secret as its placeholder, even when the environment resolves it", async () => {
    const r = await run([PETSTORE, "--env", "local"], { token: "s3cret-token" });
    expect(r.out).toContain("Authorization: Bearer {{token}}");
    expect(r.out).not.toContain("s3cret-token");
  });

  it("inlines it on --with-secrets", async () => {
    const r = await run([PETSTORE, "--env", "local", "--with-secrets"], { token: "s3cret-token" });
    expect(r.out).toContain("Authorization: Bearer s3cret-token");
  });

  it("leaves an unresolved secret as its authored placeholder", async () => {
    const r = await run([PETSTORE, "--env", "local"]);
    expect(r.out).toContain("Authorization: Bearer {{token}}");
  });

  it("renders another language on --lang", async () => {
    const r = await run([PETSTORE, "--env", "local", "--lang", "python-requests"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("import requests");
    expect(r.out).toContain("http://localhost:4000/pets/1");
  });

  it("lists every target with --list", async () => {
    const r = await run(["--list"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("curl");
    expect(r.out).toContain("python-requests");
    expect(r.out.trim().split("\n").length).toBeGreaterThanOrEqual(17);
  });

  it("writes to a file with --output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-codegen-"));
    try {
      const file = join(dir, "snippet.sh");
      const r = await run([PETSTORE, "--env", "local", "--output", file]);
      expect(r.code).toBe(0);
      expect(readFileSync(file, "utf8")).toContain("curl -X GET");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unknown language with usage guidance", async () => {
    const r = await run([PETSTORE, "--lang", "cobol"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Unknown --lang "cobol"/);
    expect(r.err).toMatch(/--list/);
  });

  it("errors with exit 2 when no request path is given", async () => {
    const r = await run([]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Usage: truspec codegen/);
  });

  it("errors with exit 1 for a missing file", async () => {
    const r = await run(["nope.tspec.yaml"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Path not found/);
  });
});
