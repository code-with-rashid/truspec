import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { confinePath } from "../src/workspace";

describe("confinePath", () => {
  it("allows paths inside the workspace (existing and not-yet-existing)", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-cf-"));
    try {
      mkdirSync(join(dir, "sub"));
      writeFileSync(join(dir, "sub", "a.txt"), "x");
      expect(confinePath(dir, "sub/a.txt")).toBe(join(dir, "sub", "a.txt"));
      expect(confinePath(dir, "sub/new.txt")).toBe(join(dir, "sub", "new.txt")); // write target
      expect(confinePath(dir, ".")).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects ../ escapes", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-cf-"));
    try {
      expect(() => confinePath(dir, "../../etc/passwd")).toThrow(/escapes/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects symlink escapes (a string-based guard would not)", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-cf-"));
    const outside = mkdtempSync(join(tmpdir(), "truspec-out-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "secret");
      symlinkSync(outside, join(dir, "link")); // dir/link -> outside
      expect(() => confinePath(dir, "link/secret.txt")).toThrow(/escapes/);
      expect(() => confinePath(dir, "link")).toThrow(/escapes/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
