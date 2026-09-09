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

  it("warns loudly when --insecure turns off certificate verification", async () => {
    const cap = capture();
    let handle: { close: () => Promise<void> } | undefined;
    const code = await serveCommand(["--dir", "examples/petstore", "--port", "0", "--insecure"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
      block: false,
      onReady: (h) => { handle = h as typeof handle; },
    });
    try {
      expect(code).toBe(0);
      // Silence here would mean every request the UI sends for the life of the server is
      // unverified, with nothing on screen or in the terminal saying so.
      expect(cap.err).toMatch(/--insecure disables TLS certificate verification for every request/);
    } finally {
      await handle?.close();
    }
  });

  it("refuses to start rather than serving with a CA file it could not read", async () => {
    const cap = capture();
    const code = await serveCommand(["--dir", "examples/petstore", "--port", "0", "--ca", "no-such-ca.pem"], {
      cwd: repoRoot, stdout: cap.stdout, stderr: cap.stderr, block: false,
    });
    expect(code).toBe(1);
    expect(cap.err).toMatch(/could not configure transport/);
  });

  it("takes proxy settings from the environment, the same as `run`", async () => {
    const cap = capture();
    let handle: { close: () => Promise<void> } | undefined;
    const code = await serveCommand(["--dir", "examples/petstore", "--port", "0"], {
      cwd: repoRoot,
      processEnv: { HTTPS_PROXY: "http://proxy.invalid:8080" },
      stdout: cap.stdout, stderr: cap.stderr, block: false,
      onReady: (h) => { handle = h as typeof handle; },
    });
    try {
      expect(code).toBe(0); // configured without throwing; the proxy is never dialled at startup
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
