import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initCommand } from "../src/commands/init";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-init-cli-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

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

async function run(argv: string[], cwd = dir) {
  const cap = capture();
  const code = await initCommand(argv, { cwd, processEnv: {}, stdout: cap.stdout, stderr: cap.stderr });
  return { code, out: cap.out, err: cap.err };
}

describe("truspec init", () => {
  it("scaffolds into the current directory and prints next steps", async () => {
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("created  api/health.tspec.yaml");
    expect(r.out).toContain("Next:");
    expect(r.out).toContain("truspec run api --env local");
    expect(existsSync(join(dir, "environments/local.env.yaml"))).toBe(true);
  });

  it("scaffolds into a named subdirectory", async () => {
    const r = await run(["project"]);
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, "project/api/health.tspec.yaml"))).toBe(true);
  });

  it("reports what it left alone on a re-run instead of overwriting", async () => {
    await run([]);
    const second = await run([]);
    expect(second.code).toBe(0);
    expect(second.out).toContain("left alone");
    expect(second.out).toContain("already set up");
  });

  it("scaffolds from a spec and points the next steps at the local mock", async () => {
    const r = await run(["--spec", join(repoRoot, "examples/blog/openapi.yaml")]);
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, "api/getpost.tspec.yaml"))).toBe(true);
    expect(r.out).toContain("truspec mock --spec");
    // Path variables the scaffold introduced must be declared, or the first run cannot resolve.
    expect(readFileSync(join(dir, "environments/local.env.yaml"), "utf8")).toContain("id:");
  });

  it("exits 1 for a missing spec", async () => {
    const r = await run(["--spec", "nope.yaml"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Spec not found/);
  });

  it("honors --dir, --env and --base-url", async () => {
    await run(["--dir", "http", "--env", "staging", "--base-url", "https://staging.test"]);
    expect(existsSync(join(dir, "http/health.tspec.yaml"))).toBe(true);
    const env = readFileSync(join(dir, "environments/staging.env.yaml"), "utf8");
    expect(env).toContain("https://staging.test");
  });
});
