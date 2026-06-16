import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { genCommand } from "../src/commands/gen";

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

describe("truspec gen", () => {
  it("scaffolds a request per operation", async () => {
    const out = mkdtempSync(join(tmpdir(), "truspec-gen-"));
    try {
      const cap = capture();
      const code = await genCommand(["--spec", "examples/petstore/openapi.yaml", "--out", out], {
        cwd: repoRoot,
        stdout: cap.stdout,
        stderr: cap.stderr,
      });
      expect(code).toBe(0);
      expect(cap.out).toMatch(/Generated 3 request/);
      expect(readFileSync(join(out, "getpetbyid.tspec.yaml"), "utf8")).toMatch(
        /\{\{baseUrl\}\}\/pets\/\{\{id\}\}/,
      );
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("requires --spec and --out (exit 2)", async () => {
    const cap = capture();
    expect(await genCommand(["--spec", "x"], { stdout: cap.stdout, stderr: cap.stderr })).toBe(2);
    expect(cap.err).toMatch(/Usage/);
  });
});
