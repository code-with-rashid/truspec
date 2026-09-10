import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const corePkgDir = join(repoRoot, "packages", "core");

const pkg = JSON.parse(readFileSync(join(corePkgDir, "package.json"), "utf8")) as {
  exports: Record<string, { types?: string; import?: string } | string>;
  files: string[];
};

/** The importable module subpaths, without the wildcard asset entry. `"."` becomes `""`. */
const subpaths = Object.keys(pkg.exports)
  .filter((k) => !k.includes("*"))
  .map((k) => (k === "." ? "" : k.slice(1)));

/**
 * A published entry point has to be declared in **four** places that nothing forced to agree:
 * `package.json`'s `exports`, tsup's `entry` list (or it is not built and the import 404s for
 * every user), vitest's alias list (or tests silently resolve to a stale `dist` instead of `src`),
 * and `docs/api.md` (or the entry point exists and nobody can find it — which was true of seven of
 * the thirteen).
 *
 * Adding a module is the moment all four are easy to get wrong and nothing catches it until a
 * release. So this is the gate.
 */
describe("the published entry points", () => {
  it("finds them all in the exports map", () => {
    // A canary: if this list changes, the rest of this file is what to update alongside it.
    expect(subpaths).toContain("");
    expect(subpaths.length).toBeGreaterThanOrEqual(13);
  });

  it("each resolves to a real source module", () => {
    for (const p of subpaths) {
      const src = join(corePkgDir, "src", p, "index.ts");
      expect(existsSync(src), `missing source for @truspec/core${p} (expected src${p}/index.ts)`).toBe(true);
    }
  });

  it("each is built, so the published package does not 404 on import", () => {
    const tsup = readFileSync(join(corePkgDir, "tsup.config.ts"), "utf8");
    for (const p of subpaths) {
      const entry = `src${p}/index.ts`;
      expect(tsup, `@truspec/core${p} is exported but not a tsup entry`).toContain(entry);
    }
  });

  it("each has a vitest alias, so tests read src and not a stale dist", () => {
    const config = readFileSync(join(repoRoot, "vitest.config.ts"), "utf8");
    for (const p of subpaths) {
      expect(config, `@truspec/core${p} has no vitest alias`).toContain(`"@truspec/core${p}"`);
    }
  });

  it("each appears in the module table in docs/api.md", () => {
    const docs = readFileSync(join(repoRoot, "docs", "api.md"), "utf8");
    for (const p of subpaths) {
      // The main entry is described in prose below the table rather than as a row of it.
      const needle = p === "" ? "`@truspec/core`" : `\`@truspec/core${p}\``;
      expect(docs, `@truspec/core${p} is published but not documented`).toContain(needle);
    }
  });

  it("documents no subpath that does not ship", () => {
    const docs = readFileSync(join(repoRoot, "docs", "api.md"), "utf8");
    const documented = new Set(
      [...docs.matchAll(/`@truspec\/core(\/[a-z*.]+)`/g)].map((m) => m[1] as string).filter((p) => !p.includes("*")),
    );
    const shipped = new Set(subpaths.filter(Boolean));
    for (const p of documented) {
      // `schema/<file>.json` is served by the wildcard entry, not by a module subpath.
      if (p.startsWith("/schema/")) continue;
      expect(shipped.has(p), `docs/api.md names @truspec/core${p}, which is not in the exports map`).toBe(true);
    }
  });

  it("ships the schema directory the wildcard entry points at", () => {
    expect(pkg.exports["./schema/*"]).toBe("./schema/*");
    expect(pkg.files).toContain("schema");
    for (const f of ["request", "folder", "environment"]) {
      expect(existsSync(join(corePkgDir, "schema", `${f}.schema.json`))).toBe(true);
    }
  });

  /**
   * The table in `docs/api.md` labels each subpath `browser-safe` or `Node`, and that label is a
   * promise someone builds a bundle on. Nothing checked it — so `exporters` was labelled
   * browser-safe while importing `node:fs` and `workspace/`, an error the surface gate above could
   * not see because it only guards the *main* entry.
   *
   * "Browser-safe" here means what `CLAUDE.md` means by it: free of the **filesystem and server**
   * modules. Not free of every `node:` builtin — `runner` uses `node:crypto` and `Buffer`, which
   * bundlers shim, and calling that a mislabel would be testing something adjacent to the real
   * requirement rather than the requirement.
   *
   * Following one level of local import is enough: every current offender pulls it in directly or
   * via a single hop, and a deeper walk would trade a real check for a slow one.
   */
  it("labels each subpath's platform truthfully in docs/api.md", () => {
    const docs = readFileSync(join(repoRoot, "docs", "api.md"), "utf8");
    const nodeish = (file: string, depth = 0): boolean => {
      if (!existsSync(file)) return false;
      const src = readFileSync(file, "utf8");
      if (/from "node:(fs|http|https|net|tls|child_process|os|dns)/.test(src)) return true;
      if (depth >= 1) return false;
      for (const m of src.matchAll(/from "(\.[^"]+)"/g)) {
        const rel = m[1] as string;
        const base = join(file, "..", rel);
        for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
          if (nodeish(candidate, depth + 1)) return true;
        }
      }
      return false;
    };

    let checked = 0;
    for (const p of subpaths) {
      if (p === "") continue;
      const row = new RegExp(`\\\`@truspec/core${p}\\\`[^\n]*`).exec(docs);
      if (!row) continue;
      checked++;
      const claimsBrowser = row[0].includes("browser-safe");
      const isNode = nodeish(join(corePkgDir, "src", p, "index.ts"));
      if (claimsBrowser) {
        expect(isNode, `docs/api.md calls @truspec/core${p} browser-safe, but it reaches node:`).toBe(false);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it("keeps the browser-safe entry free of the Node-only modules", () => {
    const index = readFileSync(join(corePkgDir, "src", "index.ts"), "utf8");
    for (const nodeOnly of ["workspace", "spec", "importers", "mock", "http"]) {
      expect(index, `src/index.ts must not re-export ${nodeOnly} — it pulls node: modules into a browser build`).not.toContain(
        `from "./${nodeOnly}"`,
      );
    }
  });
});
