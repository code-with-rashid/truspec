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

  it("escapes HTML in assertion messages, errors, and drift/coverage keys (untrusted response data)", () => {
    // an assertion message can carry a hostile RESPONSE header/body value; it must not inject markup
    const payload = `<img src=x onerror="alert(1)"></img><script>alert(2)</script>`;
    const run: WorkspaceRunResult = {
      results: [
        { name: "n", request: { method: "GET", url: "x" }, ok: false, error: payload, assertions: [{ type: "header", ok: false, message: payload }] },
      ],
      passed: 0, failed: 1, ok: false, missingSecrets: [],
    };
    const html = renderResults(run);
    expect(html).not.toContain("<img src=x onerror");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;img");

    // drift/coverage operation keys + spec path are escaped too
    const drift: DriftReport = { specOperations: 1, collectionOperations: 0, added: [payload], removed: [], changed: [], ok: false };
    expect(renderDrift(drift, payload)).not.toContain("<img src=x onerror");
    const cov: CoverageReport = { total: 1, covered: [], uncovered: [payload], percent: 0, ok: false };
    expect(renderCoverage(cov, payload)).not.toContain("<script>alert");
  });
});
