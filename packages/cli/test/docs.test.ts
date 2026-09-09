import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { docsCommand } from "../src/commands/docs";

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

async function run(argv: string[]) {
  const cap = capture();
  const code = await docsCommand(argv, { cwd: repoRoot, processEnv: {}, stdout: cap.stdout, stderr: cap.stderr });
  return { code, out: cap.out, err: cap.err };
}

describe("truspec docs", () => {
  it("renders the example collection to stdout", async () => {
    const r = await run(["examples/blog"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("### Create post");
    expect(r.out).toContain("curl -X POST");
  });

  it("writes to a file with --out and uses a custom title", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-docs-cli-"));
    try {
      const file = join(dir, "api.md");
      const r = await run(["examples/blog", "--out", file, "--title", "Blog API"]);
      expect(r.code).toBe(0);
      expect(readFileSync(file, "utf8").startsWith("# Blog API")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders examples in another language, or omits them", async () => {
    expect((await run(["examples/blog", "--lang", "go"])).out).toContain("net/http");
    expect((await run(["examples/blog", "--lang", "none"])).out).not.toContain("<details>");
  });

  it("rejects an unknown language and an out-of-range heading level", async () => {
    const lang = await run(["examples/blog", "--lang", "cobol"]);
    expect(lang.code).toBe(2);
    expect(lang.err).toMatch(/Unknown --lang "cobol"/);

    const level = await run(["examples/blog", "--base-level", "9"]);
    expect(level.code).toBe(2);
    expect(level.err).toMatch(/--base-level must be an integer/);
  });

  it("shifts headings for embedding with --base-level", async () => {
    expect((await run(["examples/blog", "--base-level", "2"])).out.startsWith("## ")).toBe(true);
  });

  it("exits 1 for a missing path and for a directory with no requests", async () => {
    const missing = await run(["nope"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/Path not found/);

    const empty = mkdtempSync(join(tmpdir(), "truspec-docs-empty-"));
    try {
      const r = await run([empty]);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/No .tspec.yaml requests found/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("rejects a malformed flag with exit 2", async () => {
    const r = await run(["--nope"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Usage: truspec docs/);
  });
});
