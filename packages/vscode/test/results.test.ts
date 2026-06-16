import { describe, expect, it } from "vitest";
import type { CoverageReport, DriftReport } from "@truspec/core/spec";
import type { WorkspaceRunResult } from "@truspec/core/workspace";
import { renderCoverage, renderDrift, renderResults } from "../src/results";

describe("vscode results rendering", () => {
  it("renders run results with pass/fail and failure messages", () => {
    const result: WorkspaceRunResult = {
      results: [
        {
          name: "Get pet",
          request: { method: "GET", url: "x" },
          ok: true,
          response: { status: 200, statusText: "OK", durationMs: 12, bodyText: "{}", headers: {} },
          assertions: [],
        },
        {
          name: "Bad",
          request: { method: "GET", url: "y" },
          ok: false,
          response: { status: 500, statusText: "ERR", durationMs: 5, bodyText: "", headers: {} },
          assertions: [{ type: "status", ok: false, message: "status 500 fails == 200" }],
        },
      ],
      passed: 1,
      failed: 1,
      ok: false,
      missingSecrets: [],
    };
    const html = renderResults(result);
    expect(html).toContain("Get pet");
    expect(html).toContain("1 passed · 1 failed");
    expect(html).toContain("status 500 fails");
    expect(html).toContain("◢◤ TruSpec");
  });

  it("renders drift and coverage", () => {
    const drift: DriftReport = {
      specOperations: 4,
      collectionOperations: 3,
      added: ["GET /users/{id}"],
      removed: [],
      changed: [],
      ok: false,
    };
    expect(renderDrift(drift, "openapi.yaml")).toContain("GET /users/{id}");

    const cov: CoverageReport = {
      total: 4,
      covered: ["a", "b", "c"],
      uncovered: ["GET /users/{id}"],
      percent: 75,
      ok: true,
    };
    const html = renderCoverage(cov, "openapi.yaml");
    expect(html).toContain("75%");
    expect(html).toContain("width:75%");
  });

  it("escapes HTML in names", () => {
    const result: WorkspaceRunResult = {
      results: [{ name: "<script>", request: { method: "GET", url: "x" }, ok: true, assertions: [] }],
      passed: 1,
      failed: 0,
      ok: true,
      missingSecrets: [],
    };
    const html = renderResults(result);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('"name"><script>');
  });
});
