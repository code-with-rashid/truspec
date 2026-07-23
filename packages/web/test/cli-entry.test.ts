import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSidecar } from "../server/cli-entry";
import type { WebServerHandle } from "../server/index";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const petstoreDir = resolve(repoRoot, "examples", "petstore");
const clientDir = resolve(repoRoot, "packages", "web", "dist", "client");

describe("runSidecar", () => {
  let handle: WebServerHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("prints one JSON line with the bound url/port, and the server actually answers", async () => {
    let out = "";
    handle = await runSidecar(["--dir", petstoreDir, "--client-dir", clientDir, "--port", "0"], {
      stdout: (s) => {
        out += s;
      },
    });
    expect(handle).toBeDefined();
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed).toEqual({ url: handle?.url, port: handle?.port });

    const res = await fetch(`${handle?.url}/api/state`);
    expect(res.status).toBe(200);
    const state = (await res.json()) as { requests: unknown[] };
    expect(state.requests.length).toBe(1);
  });

  it("defaults to an ephemeral port when --port is omitted", async () => {
    handle = await runSidecar(["--dir", petstoreDir, "--client-dir", clientDir]);
    expect(handle?.port).toBeGreaterThan(0);
  });

  it("requires --dir and --client-dir, exiting 2 with a usage message (no server started)", async () => {
    const errs: string[] = [];
    const exits: number[] = [];
    const missingDir = await runSidecar(["--client-dir", clientDir], {
      stderr: (s) => errs.push(s),
      exit: (c) => exits.push(c),
    });
    expect(missingDir).toBeUndefined();
    expect(exits).toEqual([2]);
    expect(errs[0]).toMatch(/Usage:/);

    const missingClientDir = await runSidecar(["--dir", petstoreDir], {
      stderr: (s) => errs.push(s),
      exit: (c) => exits.push(c),
    });
    expect(missingClientDir).toBeUndefined();
  });

  it("rejects a non-numeric --port without starting a server", async () => {
    const errs: string[] = [];
    const exits: number[] = [];
    const result = await runSidecar(["--dir", petstoreDir, "--client-dir", clientDir, "--port", "nope"], {
      stderr: (s) => errs.push(s),
      exit: (c) => exits.push(c),
    });
    expect(result).toBeUndefined();
    expect(exits).toEqual([2]);
    expect(errs[0]).toMatch(/Invalid --port/);
  });
});
