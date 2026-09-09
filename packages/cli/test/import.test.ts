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

  it("rejects an unknown source, listing the ones it does support", async () => {
    const cap = capture();
    const code = await importCommand(["soapui", "x.xml"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(2);
    expect(cap.err).toMatch(/postman\|bruno\|insomnia\|curl\|har/);
  });

  it("imports a HAR file, honoring --filter and --base-url-var", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-import-har-"));
    try {
      const har = join(dir, "session.har");
      writeFileSync(
        har,
        JSON.stringify({
          log: {
            entries: [
              { request: { method: "GET", url: "https://api.example.com/pets", headers: [] }, response: { status: 200 } },
              { request: { method: "GET", url: "https://cdn.example.com/logo.png", headers: [] }, response: { status: 200 } },
            ],
          },
        }),
      );
      const cap = capture();
      const code = await importCommand(
        ["har", har, "--out", join(dir, "out"), "--filter", "api.example.com", "--base-url-var", "baseUrl"],
        { cwd: repoRoot, stdout: cap.stdout, stderr: cap.stderr },
      );
      expect(code).toBe(0);
      expect(cap.out).toMatch(/Wrote 1 file/);
      expect(readFileSync(join(dir, "out", "get-pets.tspec.yaml"), "utf8")).toContain("{{baseUrl}}/pets");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 when a HAR holds nothing importable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-import-har-bad-"));
    try {
      const har = join(dir, "empty.har");
      writeFileSync(har, JSON.stringify({ log: { entries: [] } }));
      const cap = capture();
      const code = await importCommand(["har", har, "--out", join(dir, "out")], {
        cwd: repoRoot,
        stdout: cap.stdout,
        stderr: cap.stderr,
      });
      expect(code).toBe(1);
      expect(cap.err).toMatch(/No importable entries/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a HAR file that is not JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-import-har-junk-"));
    try {
      const har = join(dir, "junk.har");
      writeFileSync(har, "not json at all");
      const cap = capture();
      const code = await importCommand(["har", har], { cwd: repoRoot, stdout: cap.stdout, stderr: cap.stderr });
      expect(code).toBe(1);
      expect(cap.err).toMatch(/Failed to read HAR file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("previews a curl import without writing anything", async () => {
    const cap = capture();
    const code = await importCommand(["curl", "curl https://api.example.com/pets"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out).toMatch(/dry run/);
    expect(cap.out).toMatch(/get-pets\.tspec\.yaml/);
  });

  it("uses --name as the base filename for a curl import", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-import-name-"));
    try {
      const cap = capture();
      await importCommand(
        ["curl", "curl https://api.example.com/pets", "--out", dir, "--name", "My Request"],
        { cwd: repoRoot, stdout: cap.stdout, stderr: cap.stderr },
      );
      expect(readFileSync(join(dir, "my-request.tspec.yaml"), "utf8")).toContain("api.example.com");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
