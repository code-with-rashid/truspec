import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { importCommand } from "../src/commands/import";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

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

describe("truspec import", () => {
  it("dry-runs a postman import and lists files (exit 0)", async () => {
    const cap = capture();
    const code = await importCommand(["postman", "examples/imports/postman-collection.json"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out).toMatch(/users\/get-user\.tspec\.yaml/);
    expect(cap.out).toMatch(/dry run/);
  });

  it("writes files with --out", async () => {
    const out = mkdtempSync(join(tmpdir(), "truspec-import-"));
    try {
      const cap = capture();
      const code = await importCommand(
        ["postman", "examples/imports/postman-collection.json", "--out", out],
        { cwd: repoRoot, stdout: cap.stdout, stderr: cap.stderr },
      );
      expect(code).toBe(0);
      expect(readFileSync(join(out, "users", "get-user.tspec.yaml"), "utf8")).toMatch(/Get user/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("imports bruno directories", async () => {
    const cap = capture();
    const code = await importCommand(["bruno", "examples/imports/bruno"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out).toMatch(/get-user\.tspec\.yaml/);
  });

  it("rejects an unknown source (exit 2)", async () => {
    const cap = capture();
    const code = await importCommand(["soapui", "x"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(2);
    expect(cap.err).toMatch(/Usage/);
  });
});
