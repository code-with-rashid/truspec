import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const pkg = (name: string): string =>
  (JSON.parse(readFileSync(resolve(ROOT, "packages", name, "package.json"), "utf8")) as { version: string }).version;

/**
 * RELEASING.md versions the published packages in lockstep, and the desktop app alongside them for
 * traceability. Nothing checked it. The version reaches users in three places that are edited by
 * hand — the npm packages, the installer filenames, and `truspec --version` — and a release is
 * exactly when nobody is looking closely, so a number left behind ships under the wrong name.
 */
describe("every package ships one version", () => {
  const version = pkg("core");

  it("keeps the published packages and the desktop app in lockstep", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const name of ["cli", "mcp-server", "web", "desktop"]) {
      expect({ name, version: pkg(name) }).toEqual({ name, version });
    }
  });

  /**
   * The desktop version is written four times over two languages: npm's `package.json`, Tauri's
   * `tauri.conf.json` (which names the installers), Cargo's manifest, and the lockfile Cargo
   * regenerates from it. Only the first is covered above, and the Rust crate is compile-checked in
   * CI but never run, so nothing else would notice the other three going stale.
   */
  it("stamps that same version through the Tauri build, which names the installers", () => {
    // Git for Windows checks these out with CRLF, so a pattern spanning a line break has to allow
    // for it. Normalising on read is what the repo does elsewhere for exactly this reason; the
    // alternative — `\r?\n` in every pattern — is one easy omission away from a green Windows run
    // that checked nothing.
    const at = (...p: string[]): string =>
      readFileSync(resolve(ROOT, "packages", "desktop", ...p), "utf8").replace(/\r\n/g, "\n");

    const tauri = JSON.parse(at("src-tauri", "tauri.conf.json")) as { version: string };
    expect(tauri.version).toBe(version);

    // The crate's own `version =`, which is the first one under `[package]`.
    const cargo = /^\[package\][\s\S]*?^version = "([^"]+)"/m.exec(at("src-tauri", "Cargo.toml"));
    expect(cargo?.[1]).toBe(version);

    // The lockfile entry for this crate — Cargo rewrites it, but only when someone runs Cargo.
    const locked = /name = "truspec-desktop"\nversion = "([^"]+)"/.exec(at("src-tauri", "Cargo.lock"));
    expect(locked?.[1]).toBe(version);
  });
});
