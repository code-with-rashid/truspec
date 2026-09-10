import { describe, expect, it } from "vitest";
import { formatHuman, formatJunit } from "../src/output";
import type { WorkspaceRunResult } from "@truspec/core/workspace";

const bailedRun = (): WorkspaceRunResult =>
  ({
    results: [
      {
        name: "R1",
        filePath: "/w/r1.tspec.yaml",
        request: { method: "GET", url: "u" },
        ok: false,
        error: "boom",
        assertions: [],
      },
    ],
    skippedRequests: [
      { name: "R2", filePath: "/w/r2.tspec.yaml" },
      { name: "R3", filePath: "/w/r3.tspec.yaml" },
    ],
    passed: 0,
    failed: 1,
    skipped: 2,
    ok: false,
    missingSecrets: [],
  }) as unknown as WorkspaceRunResult;

/**
 * `--bail` stops at the first failure, and the requests it stopped before were **selected to run**.
 * The JUnit writer only ever saw `results`, so a five-request run reported as a one-test suite and
 * the four that never ran vanished from the record — a CI dashboard showing a green-ish sliver of
 * the truth. The same "omitting it reads as clean" failure the parse-error case already guarded
 * against.
 */
describe("JUnit reports what a bail skipped", () => {
  const xml = formatJunit(bailedRun(), "/w");

  it("counts every selected request, not just the ones that ran", () => {
    expect(xml).toContain('tests="3"');
    expect(xml).toContain('failures="1"');
  });

  it("uses the schema's own `skipped` attribute, distinct from failures", () => {
    expect(xml).toContain('skipped="2"');
  });

  it("names each skipped request, with the file it came from", () => {
    expect(xml).toContain('<testcase name="R2" classname="r2.tspec.yaml"');
    expect(xml).toContain('<testcase name="R3" classname="r3.tspec.yaml"');
    expect((xml.match(/<skipped message=/g) ?? []).length).toBe(2);
  });

  it("says why they did not run", () => {
    expect(xml).toContain("the run bailed at the first failure");
  });

  it("omits the attribute entirely when nothing was skipped", () => {
    const clean = { ...bailedRun(), skippedRequests: undefined, skipped: 0 } as WorkspaceRunResult;
    expect(formatJunit(clean, "/w")).not.toContain("skipped=");
  });

  it("stays valid XML", () => {
    // No parser here, but the structural invariants a reporter depends on.
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect((xml.match(/<testcase /g) ?? []).length).toBe(3);
    expect((xml.match(/<\/testsuite>/g) ?? []).length).toBe(1);
  });
});

describe("the human summary counts the same run the same way", () => {
  it("includes skipped requests in the total, which used to contradict itself", () => {
    // Before: "1 failed, 2 skipped (bailed), 1 total" — the two were selected to run.
    const out = formatHuman(bailedRun(), "/w");
    expect(out).toMatch(/2 skipped \(bailed\)/);
    expect(out).toMatch(/3 total/);
  });

  it("does not print NaN for a report that predates the skipped count", () => {
    const old = { results: [], passed: 0, failed: 0, ok: true, missingSecrets: [] } as unknown as WorkspaceRunResult;
    expect(formatHuman(old, "/w")).not.toContain("NaN");
  });
});
