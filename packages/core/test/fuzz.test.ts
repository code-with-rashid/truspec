import { describe, expect, it } from "vitest";
import { validateAgainstSchema } from "../src/spec/validate-response";
import { resolveRequest } from "../src/runner/resolve";
import { buildRoutes, createMockResponder } from "../src/mock/engine";
import { interpolate } from "../src/runner/interpolate";
import { scaffoldFromSpec } from "../src/spec/scaffold";
import { importPostman } from "../src/importers/postman";
import { parse } from "../src/format";

/**
 * Committed, SEEDED, deterministic property-fuzz — the persistent successor to campaigns 1–10's scratch
 * harnesses. Seeds are recorded in qa/SEEDS.json; the historically-interesting crash inputs in
 * qa/corpus/. Bounded for CI (3k iters/target); the 1M-exec budget is a scheduled continuous-fuzz job.
 * Each target asserts an INVARIANT (see qa/INVENTORY.md INV-*): no crash, no hang, no lost data.
 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEEDS = [0x9e3779b9, 0xc10c10c1, 0x5a17ed00, 0x0ddba11, 0xf1f2f3f4];
const N = 3000;

describe("seeded property fuzz (invariants)", () => {
  it("INV-5: validateAgainstSchema terminates fast & never throws on recursive $ref + cyclic values", () => {
    let crashes = 0, slowest = 0;
    const doc: Record<string, unknown> = { components: { schemas: { S: { oneOf: [{ type: "string" }, { $ref: "#/components/schemas/S" }], allOf: [{ $ref: "#/components/schemas/S" }] } } } };
    for (const seed of SEEDS) {
      const r = mulberry32(seed); const pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)]!;
      const schema = (d: number): Record<string, unknown> => d > 4 ? pick([{ type: "string" }, { $ref: "#/components/schemas/S" }]) : { type: pick(["object", "array", "integer", ["string", "null"]]), properties: { a: schema(d + 1), b: { $ref: "#/components/schemas/S" } }, required: pick([["a"], ["nope"]]), items: { $ref: "#/components/schemas/S" }, allOf: [schema(d + 1)] };
      const val = (d: number): unknown => { if (d > 6) return pick([1, "s", null]); const t = r(); if (t < 0.4) return pick([1, 1.5, "s", true, null]); if (t < 0.6) return [val(d + 1), val(d + 1)]; const o: Record<string, unknown> = {}; for (let k = 0; k < Math.floor(r() * 3); k++) o[pick(["a", "b", "x"])] = val(d + 1); if (r() < 0.05) o.self = o; return o; };
      for (let i = 0; i < N; i++) { const t0 = Date.now(); try { validateAgainstSchema(val(0), schema(0), doc); } catch { crashes++; } slowest = Math.max(slowest, Date.now() - t0); }
    }
    expect(crashes).toBe(0);
    expect(slowest).toBeLessThan(200);
  });

  it("INV-3: resolveRequest never loses a query param to a #fragment", () => {
    let lost = 0, crashes = 0;
    for (const seed of SEEDS) {
      const r = mulberry32(seed); const pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)]!;
      for (let i = 0; i < N; i++) {
        const url = `http://h/${pick(["a", "a/b"])}${pick(["", "?z=0", "?z=0&w=1"])}${pick(["", "#f", "#a?b=c", "#x#y"])}`;
        const q: Record<string, string> = {}; for (let k = 0; k < Math.floor(r() * 4); k++) q[`k${k}_${Math.floor(r() * 9)}`] = pick(["v", "a b", "x&y", "é"]);
        try { const u = new URL(resolveRequest({ tspec: "0.1", name: "r", method: "GET", url, query: q, assertions: [] } as never, {}).url); for (const key of Object.keys(q)) if (u.searchParams.get(key) === null) lost++; } catch { crashes++; }
      }
    }
    expect(lost).toBe(0);
    expect(crashes).toBe(0);
  });

  it("INV-4 / no-ReDoS: mock pathToRegex matches a hostile path in bounded time; status always 200-599", () => {
    let slowest = 0, badStatus = 0;
    const hostile = "/" + "a".repeat(5000) + "/x/y/z";
    for (const seed of SEEDS) {
      const r = mulberry32(seed); const pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)]!;
      for (let i = 0; i < 300; i++) {
        let path = ""; for (let s = 0; s < Math.floor(r() * 5) + 1; s++) path += "/" + Array.from({ length: Math.floor(r() * 4) + 1 }, () => pick(["{p}", "{q}", "lit"])).join("");
        const code = pick(["100", "200", "404", "600", "20000", "0", "default"]);
        const spec = `openapi: 3.0.3\ninfo: { title: T, version: "1" }\npaths: ${JSON.stringify({ [path]: { get: { responses: { [code]: { content: { "application/json": { schema: {} } } } } } } })}\n`;
        const re = buildRoutes(JSON.parse(`{"paths":${JSON.stringify({ [path]: { get: { responses: {} } } })}}`))[0]?.regex;
        if (re) { const t0 = Date.now(); re.test(hostile); slowest = Math.max(slowest, Date.now() - t0); }
        const res = createMockResponder(spec).respond("GET", path.replace(/\{[^}]+\}/g, "1"));
        if (res && (res.status < 200 || res.status > 599)) badStatus++;
      }
    }
    expect(slowest).toBeLessThan(100);
    expect(badStatus).toBe(0);
  });

  it("no template re-injection: a var value containing {{x}} is not re-expanded", () => {
    let reinj = 0;
    for (const seed of SEEDS) {
      const r = mulberry32(seed); const pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)]!;
      for (let i = 0; i < N; i++) {
        const tmpl = Array.from({ length: Math.floor(r() * 5) }, () => pick(["{{a}}", "x", "{{", "$&", "{{a-b}}"])).join("");
        const out = interpolate(tmpl, { a: "{{b}}", b: "LEAK", "a-b": "z" }).value;
        if (out.includes("LEAK")) reinj++;
      }
    }
    expect(reinj).toBe(0);
  });

  it("INV-1: scaffold + importer always emit parseable files, never collide/crash", () => {
    let bad = 0;
    for (const seed of SEEDS) {
      const r = mulberry32(seed); const pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)]!;
      for (let i = 0; i < 400; i++) {
        const paths: Record<string, unknown> = {};
        for (let p = 0; p < Math.floor(r() * 4) + 1; p++) paths["/" + pick(["a", "a-b", "a/b", "{id}"])] = { get: { ...(r() < 0.5 ? { operationId: pick(["", "Op", "op", "名"]) } : {}), responses: { "200": { description: "ok" } } } };
        try { const sr = scaffoldFromSpec(`openapi: 3.0.3\ninfo: { title: T, version: "1" }\npaths: ${JSON.stringify(paths)}\n`); const fp = sr.files.map((f) => f.path); if (new Set(fp).size !== fp.length) bad++; for (const f of sr.files) parse.request.parse(f.content); } catch { bad++; }
        try { for (const f of importPostman({ item: [{ name: pick(["", "x", "__proto__"]), request: { method: "GET", url: "http://x?a=1#f" } }] }).files) parse.request.parse(f.content); } catch { bad++; }
      }
    }
    expect(bad).toBe(0);
  });
});
