import { describe, expect, it } from "vitest";
import type { CollectionOp } from "../src/spec/collection";
import { computeCoverage } from "../src/spec/coverage";
import type { SpecOperation } from "../src/spec/openapi";

const op = (key: string): SpecOperation => ({ key }) as SpecOperation;

const linked = (operation: string, name: string, hasAssertions: boolean, filePath?: string): CollectionOp => ({
  name,
  ...(filePath ? { filePath } : {}),
  ref: { operation },
  hasAssertions,
  queryParams: [],
  hasBody: false,
});

describe("coverage explains why an operation is uncovered", () => {
  it("names the request and file when one exists but asserts nothing", () => {
    // The case that makes `coverage` baffling: you wrote a request for every operation and still
    // see 0%, with nothing on screen distinguishing "write a request" from "add an assertion".
    const report = computeCoverage(
      [op("GET /health"), op("GET /pets/{id}")],
      [linked("GET /health", "Health", false, "/w/api/health.tspec.yaml")],
    );
    expect(report.percent).toBe(0);
    expect(report.uncovered).toEqual(["GET /health", "GET /pets/{id}"]);
    expect(report.unasserted).toEqual([
      { op: "GET /health", request: "Health", filePath: "/w/api/health.tspec.yaml" },
    ]);
  });

  it("says nothing about an operation no request points at", () => {
    const report = computeCoverage([op("GET /pets/{id}")], []);
    expect(report.uncovered).toEqual(["GET /pets/{id}"]);
    expect(report.unasserted).toEqual([]);
  });

  it("omits filePath rather than inventing one when the op has no file", () => {
    const report = computeCoverage([op("GET /health")], [linked("GET /health", "Health", false)]);
    expect(report.unasserted).toEqual([{ op: "GET /health", request: "Health" }]);
  });

  it("does not change what counts as covered", () => {
    // The whole point is a better explanation of the same number, not a different number.
    const asserting = linked("GET /health", "Health", true);
    const silent = linked("GET /health", "Health (smoke)", false);
    for (const ops of [[asserting, silent], [silent, asserting]]) {
      const report = computeCoverage([op("GET /health")], ops);
      expect(report.percent).toBe(100);
      expect(report.covered).toEqual(["GET /health"]);
      // One request asserting is enough; the silent sibling is not a complaint.
      expect(report.unasserted).toEqual([]);
    }
  });

  it("sorts by operation, so the report is stable enough to diff", () => {
    const report = computeCoverage(
      [op("GET /zebra"), op("GET /apple")],
      [linked("GET /zebra", "Z", false), linked("GET /apple", "A", false)],
    );
    expect(report.unasserted?.map((u) => u.op)).toEqual(["GET /apple", "GET /zebra"]);
  });
});
