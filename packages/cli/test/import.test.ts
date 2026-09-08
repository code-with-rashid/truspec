import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("imports a curl command given inline as the argument", async () => {
    const out = mkdtempSync(join(tmpdir(), "truspec-import-curl-"));
    try {
      const cap = capture();
      const code = await importCommand(
        ["curl", `curl 'https://api.example.com/pets' -H 'Accept: application/json'`, "--out", out],
        { cwd: repoRoot, stdout: cap.stdout, stderr: cap.stderr },
      );
      expect(code).toBe(0);
      expect(cap.out).toMatch(/Wrote 1 file/);
      const written = readFileSync(join(out, "get-pets.tspec.yaml"), "utf8");
      expect(written).toContain("url: https://api.example.com/pets");
      expect(written).toContain("Accept: application/json");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("reads a curl command from a file when the argument is a path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-import-curlfile-"));
    try {
      const src = join(dir, "cmd.sh");
      writeFileSync(src, "curl -X POST https://api.example.com/pets -d '{\"name\":\"Rex\"}'\n");
      const cap = capture();
      const code = await importCommand(["curl", src, "--out", join(dir, "out")], {
        cwd: repoRoot,
        stdout: cap.stdout,
        stderr: cap.stderr,
      });
      expect(code).toBe(0);
      expect(readFileSync(join(dir, "out", "post-pets.tspec.yaml"), "utf8")).toContain("Rex");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 when the input holds no curl command", async () => {
    const cap = capture();
    const code = await importCommand(["curl", "not a command"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
    expect(cap.err).toMatch(/No curl command/);
  });

  it("rejects an unknown source with usage listing curl", async () => {
    const cap = capture();
    const code = await importCommand(["insomnia", "x.json"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(2);
    expect(cap.err).toMatch(/postman\|bruno\|curl/);
  });
});
