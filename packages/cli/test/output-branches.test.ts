import { describe, expect, it } from "vitest";
import { formatContract, formatCoverage, formatDrift, formatHuman, formatJson, formatJunit } from "../src/output";

const run = (results: unknown[], passed = 0, failed = 0): never =>
  ({ results, passed, failed, ok: failed === 0, missingSecrets: [] }) as never;

describe("output formatter branch coverage", () => {
  it("formatHuman covers pass, fail-with-error, fail-with-assertions, no-response", () => {
    const r = run([
      { name: "A", filePath: "/x/a.tspec.yaml", request: { method: "GET", url: "u" }, ok: true, response: { status: 200, statusText: "OK", durationMs: 5, bodyText: "{}", headers: {} }, assertions: [] },
      { name: "B", request: { method: "GET", url: "u" }, ok: false, error: "boom", assertions: [] },
      { name: "C", filePath: "/x/c.tspec.yaml", request: { method: "GET", url: "u" }, ok: false, response: { status: 500, statusText: "ERR", durationMs: 9, bodyText: "", headers: {} }, assertions: [{ type: "status", ok: false, message: "status 500 fails == 200" }] },
    ], 1, 2);
    const out = formatHuman(r, "/x");
    expect(out).toMatch(/✓ PASS  A/);
    expect(out).toMatch(/error: boom/);
    expect(out).toMatch(/✗ status 500 fails/);
    expect(out).toMatch(/1 passed, 2 failed, 3 total/);
  });

  it("formatJson is parseable", () => {
    expect(JSON.parse(formatJson(run([], 0, 0)))).toHaveProperty("ok");
  });

  it("formatJunit covers ok, failure(error+assertions), and missing response time", () => {
    const xml = formatJunit(run([
      { name: "ok<&>", filePath: "/x/a.tspec.yaml", request: { method: "GET", url: "u" }, ok: true, response: { status: 200, statusText: "OK", durationMs: 1500, bodyText: "", headers: {} }, assertions: [] },
      { name: "bad", request: { method: "GET", url: "u" }, ok: false, error: "err<x>", assertions: [{ type: "status", ok: false, message: "msg & <b>" }] },
    ], 1, 1), "/x");
    expect(xml).toMatch(/<testsuites tests="2" failures="1">/);
    expect(xml).toMatch(/name="ok&lt;&amp;&gt;"/); // escaped name
    expect(xml).toMatch(/time="1.500"/);
    expect(xml).toMatch(/<failure message="err&lt;x&gt;; msg &amp; &lt;b&gt;"\/>/); // escaped, joined
  });

  it("formatDrift covers added/removed/changed/liveMissing AND the clean case", () => {
    const drifted = formatDrift({ specOperations: 5, collectionOperations: 4, added: ["GET /a"], removed: ["GET /b"], changed: ["GET /c: x"], liveMissing: ["GET /d"], ok: false });
    expect(drifted).toMatch(/Untracked in collection \(1\)/);
    expect(drifted).toMatch(/Stale — not in the spec \(1\)/);
    expect(drifted).toMatch(/Changed \(1\)/);
    expect(drifted).toMatch(/Missing from live API \(1\)/);
    expect(drifted).toMatch(/Drift detected:.*1 missing live/);
    const clean = formatDrift({ specOperations: 1, collectionOperations: 1, added: [], removed: [], changed: [], ok: true });
    expect(clean).toMatch(/No drift/);
  });

  it("formatContract covers conformed/violations/skipped/untested and both verdicts", () => {
    const bad = formatContract({ specOperations: 4, conformed: ["GET /a"], violations: [{ op: "GET /b", status: 500, message: "x" }], skipped: [{ op: "GET /c", message: "no schema" }], untested: ["GET /d"], ok: false });
    expect(bad).toMatch(/Violations \(1\)/);
    expect(bad).toMatch(/Skipped/);
    expect(bad).toMatch(/Untested/);
    expect(bad).toMatch(/Contract violations: 1/);
    const good = formatContract({ specOperations: 1, conformed: ["GET /a"], violations: [], skipped: [], untested: [], ok: true });
    expect(good).toMatch(/All 1 tested operation\(s\) conform/);
  });

  it("formatCoverage covers uncovered list and the all-covered case", () => {
    expect(formatCoverage({ total: 2, covered: ["a"], uncovered: ["GET /b"], percent: 50, ok: false })).toMatch(/Uncovered \(1\)/);
    expect(formatCoverage({ total: 1, covered: ["a"], uncovered: [], percent: 100, ok: true })).toMatch(/Coverage: 100%/);
  });
});
