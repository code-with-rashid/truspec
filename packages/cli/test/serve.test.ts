import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { serveCommand } from "../src/commands/serve";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
function capture() {
  let out = "", err = "";
  return { stdout: (s: string) => (out += s), stderr: (s: string) => (err += s), get out() { return out; }, get err() { return err; } };
}

describe("truspec serve", () => {
  it("starts the web server, prints the URL, and is closable (block:false)", async () => {
    const cap = capture();
    let handle: { url: string; dir: string; close: () => Promise<void> } | undefined;
    const code = await serveCommand(["--dir", "examples/petstore", "--port", "0"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
      block: false,
      onReady: (h) => { handle = h as typeof handle; },
    });
    try {
      expect(code).toBe(0);
      expect(cap.out).toMatch(/TruSpec web UI on http:\/\/127\.0\.0\.1:\d+/);
      expect(cap.out).toMatch(/examples\/petstore/);
      expect(handle?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await handle?.close();
    }
  });

  it("exits 2 on an unknown flag", async () => {
    const cap = capture();
    const code = await serveCommand(["--bogus"], { cwd: repoRoot, stdout: cap.stdout, stderr: cap.stderr, block: false });
    expect(code).toBe(2);
    expect(cap.err.length).toBeGreaterThan(0);
  });

  it("defaults the served dir to cwd when --dir is omitted", async () => {
    const cap = capture();
    let handle: { close: () => Promise<void> } | undefined;
    const code = await serveCommand(["--port", "0"], {
      cwd: resolve(repoRoot, "examples", "blog"),
      stdout: cap.stdout, stderr: cap.stderr, block: false,
      onReady: (h) => { handle = h as typeof handle; },
    });
    try {
      expect(code).toBe(0);
      expect(cap.out).toMatch(/examples\/blog/);
    } finally {
      await handle?.close();
    }
  });
});
