import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runSidecar } from "../server/cli-entry";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const desktop = join(repoRoot, "packages", "desktop");

const read = (...parts: string[]): string => readFileSync(join(...parts), "utf8");
const sidecarRs = read(desktop, "src-tauri", "src", "sidecar.rs");
const prepare = read(desktop, "scripts", "prepare-sidecar.mjs");
const cliEntry = read(repoRoot, "packages", "web", "server", "cli-entry.ts");
const tauriConf = JSON.parse(read(desktop, "src-tauri", "tauri.conf.json")) as {
  bundle: { externalBin: string[]; resources: Record<string, string> };
};

/**
 * The desktop app is a Rust process spawning a bundled Node runtime on a bundled script. Five
 * artifacts have to agree for a shipped installer to work, and **nothing checked any of it**:
 *
 * | Artifact | What it decides |
 * |---|---|
 * | `prepare-sidecar.mjs` | where the node binary and resources are staged |
 * | `tauri.conf.json` | which staged paths get bundled, and where they land |
 * | `sidecar.rs` | the resource names resolved at runtime, and the flags passed |
 * | `cli-entry.ts` | which flags are accepted |
 * | both | the JSON handshake printed on stdout |
 *
 * A rename on either side of that boundary typechecks fine in both languages and breaks the app
 * only for someone who installed a release. This is the seam that has no compiler.
 */
describe("the desktop sidecar contract", () => {
  it("passes only flags the entry point accepts", () => {
    // Flags in the Rust `args` vector, e.g. `"--client-dir".to_string(),`.
    const passed = [...sidecarRs.matchAll(/"(--[a-z-]+)"\.to_string\(\)/g)].map((m) => m[1] as string);
    expect(passed.length, "found no flags in sidecar.rs — this test would pass vacuously").toBeGreaterThan(0);

    const optionsBlock = /const options = \{(.*?)\} as const;/s.exec(cliEntry)?.[1] ?? "";
    const accepted = new Set(
      [...optionsBlock.matchAll(/(?:^|[{,])\s*"?([a-z][a-z-]*)"?\s*:\s*\{/g)].map((m) => `--${m[1] as string}`),
    );
    expect(accepted.size).toBeGreaterThan(0);
    for (const flag of passed) {
      expect(accepted.has(flag), `sidecar.rs passes ${flag}, which cli-entry does not accept`).toBe(true);
    }
  });

  it("passes both flags the entry point requires", () => {
    // `--dir` and `--client-dir` are required; a sidecar missing either exits 2 with a usage line.
    for (const flag of ["--dir", "--client-dir"]) {
      expect(sidecarRs, `sidecar.rs never passes ${flag}, which cli-entry requires`).toContain(`"${flag}".to_string()`);
    }
  });

  it("resolves resource names the bundle actually installs", () => {
    // `app.path().resolve("server/cli-entry.cjs", BaseDirectory::Resource)`
    const resolved = [...sidecarRs.matchAll(/\.resolve\("([^"]+)",\s*BaseDirectory::Resource\)/g)].map(
      (m) => m[1] as string,
    );
    expect(resolved.length).toBeGreaterThan(0);
    const installed = new Set(Object.values(tauriConf.bundle.resources));
    for (const name of resolved) {
      expect(installed.has(name), `sidecar.rs resolves "${name}", which tauri.conf.json does not install`).toBe(true);
    }
  });

  it("bundles only paths the staging script produces", () => {
    for (const staged of Object.keys(tauriConf.bundle.resources)) {
      // `resources/server/cli-entry.cjs` and `resources/client` are written by stageResources().
      const tail = staged.replace(/^resources\//, "");
      expect(prepare, `tauri.conf.json bundles "${staged}", which prepare-sidecar.mjs never stages`).toContain(
        tail.split("/").pop() as string,
      );
    }
  });

  it("names the sidecar binary the staging script writes", () => {
    // `externalBin: ["binaries/node"]` + Tauri's target-triple suffix, staged as `node-<triple>`.
    expect(tauriConf.bundle.externalBin).toContain("binaries/node");
    expect(prepare).toContain("`node-${target.triple}");
    expect(sidecarRs).toContain('sidecar("node")');
  });

  it("prints the handshake the Rust side deserializes", async () => {
    // `struct Ready { url: String }` — the field Rust needs off the single stdout line.
    const required = [...(/struct Ready \{(.*?)\}/s.exec(sidecarRs)?.[1] ?? "").matchAll(/(\w+):\s*\w+/g)].map(
      (m) => m[1] as string,
    );
    expect(required).toContain("url");

    let line = "";
    const handle = await runSidecar(
      ["--dir", repoRoot, "--client-dir", join(repoRoot, "packages", "web", "dist", "client"), "--port", "0"],
      { stdout: (s) => { line += s; }, stderr: () => {}, exit: () => {} },
    );
    try {
      const printed = JSON.parse(line) as Record<string, unknown>;
      for (const field of required) {
        expect(printed[field], `the sidecar's stdout line has no "${field}", which Ready requires`).toBeDefined();
      }
      // Exactly one line: Rust parses each stdout line as JSON and navigates on the first that fits.
      expect(line.trimEnd().split("\n")).toHaveLength(1);
    } finally {
      await handle?.close();
    }
  }, 20_000);
});
