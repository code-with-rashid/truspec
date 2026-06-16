import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { coverageCommand } from "../src/commands/coverage";
import { driftCommand } from "../src/commands/drift";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const spec = "examples/petstore/openapi.yaml";

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

describe("truspec drift", () => {
  it("detects drift and exits 1", async () => {
    const cap = capture();
    const code = await driftCommand(["examples/petstore", "--spec", spec], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
    expect(cap.out).toMatch(/GET \/pets/);
    expect(cap.out).toMatch(/Drift detected/);
  });

  it("emits json", async () => {
    const cap = capture();
    const code = await driftCommand(["examples/petstore", "--spec", spec, "--json"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
    expect(JSON.parse(cap.out).added).toContain("GET /pets");
  });

  it("requires --spec (exit 2)", async () => {
    const cap = capture();
    const code = await driftCommand([], { cwd: repoRoot, stdout: cap.stdout, stderr: cap.stderr });
    expect(code).toBe(2);
    expect(cap.err).toMatch(/Usage/);
  });
});

describe("truspec coverage", () => {
  it("reports coverage and exits 0 (report-only)", async () => {
    const cap = capture();
    const code = await coverageCommand(["examples/petstore", "--spec", spec], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out).toMatch(/33%/);
  });

  it("fails the --min gate (exit 1)", async () => {
    const cap = capture();
    const code = await coverageCommand(["examples/petstore", "--spec", spec, "--min", "80"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
  });
});
