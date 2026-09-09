import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { exportPostman } from "../src/exporters";
import { parse } from "../src/format";
import { importPostman, writeImport } from "../src/importers";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function requestsIn(dir: string): Array<{ name: string; req: ReturnType<typeof parse.request.parse> }> {
  const out: Array<{ name: string; req: ReturnType<typeof parse.request.parse> }> = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith(".tspec.yaml") && e !== "folder.tspec.yaml") {
        const req = parse.request.parse(readFileSync(p, "utf8"));
        out.push({ name: req.name, req });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

describe("a collection survives a Postman round-trip", () => {
  it("keeps every assertion through export and re-import", () => {
    // The property that matters to anyone migrating in either direction. Before assertions were
    // mapped in both directions this lost all of them, silently, leaving a collection that ran
    // without checking anything.
    const src = join(ROOT, "examples", "blog");
    const out = mkdtempSync(join(tmpdir(), "tspec-rt-"));
    dirs.push(out);

    const exported = exportPostman(src);
    const imported = importPostman(exported.collection);
    writeImport(imported, out);

    const before = requestsIn(src);
    const after = requestsIn(out);
    expect(after.map((r) => r.name)).toEqual(before.map((r) => r.name));
    for (const [i, b] of before.entries()) {
      expect(after[i]?.req.assertions, `assertions for "${b.name}"`).toEqual(b.req.assertions);
    }
    // And every request really did carry assertions, so this cannot pass by comparing two empties.
    expect(before.every((b) => b.req.assertions.length > 0)).toBe(true);
  });

  it("keeps method, url and body too", () => {
    const src = join(ROOT, "examples", "blog");
    const out = mkdtempSync(join(tmpdir(), "tspec-rt-"));
    dirs.push(out);
    writeImport(importPostman(exportPostman(src).collection), out);

    const before = requestsIn(src);
    const after = requestsIn(out);
    for (const [i, b] of before.entries()) {
      expect(after[i]?.req.method, b.name).toBe(b.req.method);
      expect(after[i]?.req.url, b.name).toBe(b.req.url);
      expect(after[i]?.req.body ?? null, b.name).toEqual(b.req.body ?? null);
    }
  });

  it("says out loud that the spec link does not survive", () => {
    // It has no Postman equivalent. That is acceptable; losing it in silence was not.
    const exported = exportPostman(join(ROOT, "examples", "blog"));
    expect(exported.warnings.some((w) => w.includes("`spec` link has no Postman equivalent"))).toBe(true);
  });

  it("drops the ported-comment script when every line was understood", () => {
    // Keeping a commented copy of a script whose meaning is now in `assertions` is just noise.
    const out = mkdtempSync(join(tmpdir(), "tspec-rt-"));
    dirs.push(out);
    writeImport(importPostman(exportPostman(join(ROOT, "examples", "blog")).collection), out);
    for (const { name, req } of requestsIn(out)) {
      expect(req.script?.post, `script kept for "${name}"`).toBeUndefined();
    }
  });

  it("carries the chain through Postman and back", () => {
    // The capture is the part of a collection that is hardest to rebuild by hand, and both
    // directions used to drop it: the export handed over a login that checked the response and
    // threw the token away, and the import turned pm.environment.set into a comment.
    const src = mkdtempSync(join(tmpdir(), "tspec-chain-"));
    dirs.push(src);
    writeFileSync(
      join(src, "login.tspec.yaml"),
      [
        'tspec: "0.1"',
        "name: Login",
        "method: POST",
        'url: "https://api.test/login"',
        "assertions:",
        "  - { type: status, equals: 200 }",
        "capture:",
        '  token: "$.access_token"',
        "  rid: { header: X-Request-Id }",
        "  code: { status: true }",
        "",
      ].join("\n"),
    );
    const out = mkdtempSync(join(tmpdir(), "tspec-chain-out-"));
    dirs.push(out);
    writeImport(importPostman(exportPostman(src).collection), out);
    const [back] = requestsIn(out);
    expect(back?.req.capture).toEqual({
      token: "$.access_token",
      rid: { header: "X-Request-Id" },
      code: { status: true },
    });
    expect(back?.req.script?.post).toBeUndefined();
  });
});
