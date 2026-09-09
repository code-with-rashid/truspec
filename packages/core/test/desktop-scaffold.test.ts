import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../src/format/schema";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const SIDECAR_RS = resolve(ROOT, "packages", "desktop", "src-tauri", "src", "sidecar.rs");

describe("the desktop app's scaffolder tracks the schema version", () => {
  it("writes the current SCHEMA_VERSION, not a stale literal", () => {
    // "File > New Collection…" scaffolds `folder.tspec.yaml` and `environments/local.env.yaml` in
    // Rust, which cannot import the Zod schema, so the version is a literal there. CLAUDE.md
    // requires a SCHEMA_VERSION bump to ship a migration — but nothing would have caught the
    // desktop app quietly continuing to stamp the old version onto every new collection it
    // creates. The Rust crate is only compile-checked in CI, never run, so this is the check.
    const rust = readFileSync(SIDECAR_RS, "utf8");
    const stamped = [...rust.matchAll(/tspec: \\"([^\\"]+)\\"/g)].map((m) => m[1]);

    expect(stamped.length).toBeGreaterThan(0);
    for (const version of stamped) expect(version).toBe(SCHEMA_VERSION);
  });
});
