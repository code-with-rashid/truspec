import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MockServerHandle } from "@truspec/core/mock";
import { mockCommand } from "../src/commands/mock";

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

describe("truspec mock", () => {
  it("starts a server and serves a generated route", async () => {
    const cap = capture();
    let handle: MockServerHandle | undefined;
    const code = await mockCommand(["--spec", "examples/petstore/openapi.yaml", "--port", "0"], {
      cwd: repoRoot,
      block: false,
      onReady: (h) => {
        handle = h;
      },
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    try {
      expect(code).toBe(0);
      expect(handle?.routes).toBe(3);
      const res = await fetch(`${handle?.url}/pets/1`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: 1, name: "Rex", tag: "string" });
    } finally {
      await handle?.close();
    }
  });

  it("requires --spec (exit 2)", async () => {
    const cap = capture();
    expect(await mockCommand([], { stdout: cap.stdout, stderr: cap.stderr })).toBe(2);
    expect(cap.err).toMatch(/Usage/);
  });
});
