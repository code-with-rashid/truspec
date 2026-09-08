import type { WorkspaceRunResult } from "@truspec/core/workspace";
import { describe, expect, it } from "vitest";
import { formatHtml } from "../src/report-html";

const at = new Date("2026-01-02T03:04:05.000Z");

function runResult(over: Partial<WorkspaceRunResult> = {}): WorkspaceRunResult {
  return {
    results: [],
    passed: 0,
    failed: 0,
    skipped: 0,
    ok: true,
    missingSecrets: [],
    ...over,
  };
}

const passing = runResult({
  passed: 1,
  results: [
    {
      name: "Get pet",
      filePath: "/w/api/get-pet.tspec.yaml",
      request: { method: "GET", url: "https://api.test/pets/1" },
      ok: true,
      response: {
        status: 200,
        statusText: "OK",
        durationMs: 41,
        headers: { "content-type": "application/json" },
        bodyText: '{"id":1}',
      },
      assertions: [{ type: "status", ok: true, message: "status 200 == 200" }],
      captured: { petId: "1" },
    },
  ],
});

describe("html run report", () => {
  it("is a complete standalone document with no external references or scripts", () => {
    const html = formatHtml(passing, "/w", at);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    // No network fetches: the report has to open from file:// and under a strict CSP.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/src=|href=|@import|url\(http/i);
  });

  it("summarizes the verdict, counts and total time", () => {
    const html = formatHtml(passing, "/w", at);
    expect(html).toContain("<body class=\"pass\">");
    expect(html).toContain("<title>TruSpec run — 1/1 passed</title>");
    expect(html).toContain(">41<");
    expect(html).toContain("2026-01-02T03:04:05.000Z");
  });

  it("shows each request with a workspace-relative path, its assertions and captures", () => {
    const html = formatHtml(passing, "/w", at);
    expect(html).toContain("api/get-pet.tspec.yaml");
    expect(html).not.toContain("/w/api/get-pet");
    expect(html).toContain("status 200 == 200");
    expect(html).toContain("petId=1");
  });

  it("marks a failing run and lists failed assertions before passing ones", () => {
    const html = formatHtml(
      runResult({
        failed: 1,
        ok: false,
        results: [
          {
            name: "Create pet",
            request: { method: "POST", url: "https://api.test/pets" },
            ok: false,
            error: "boom",
            assertions: [
              { type: "status", ok: true, message: "ok one" },
              { type: "jsonpath", ok: false, message: "missing $.id" },
            ],
          },
        ],
      }),
      "/w",
      at,
    );
    expect(html).toContain('<body class="fail">');
    expect(html).toContain("boom");
    expect(html.indexOf("missing $.id")).toBeLessThan(html.indexOf("ok one"));
  });

  it("escapes every character that could break out of text or an attribute", () => {
    const payload = `<img src=x onerror="alert(1)"><script>alert(2)</script>'"`;
    const html = formatHtml(
      runResult({
        failed: 1,
        ok: false,
        results: [
          {
            name: payload,
            request: { method: "GET", url: payload },
            ok: false,
            error: payload,
            assertions: [{ type: "body", ok: false, message: payload }],
            response: {
              status: 500,
              statusText: payload,
              durationMs: 1,
              headers: { "x-evil": payload },
              bodyText: payload,
            },
          },
        ],
      }),
      "/w",
      at,
    );
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(2)");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain("&#39;&quot;");
  });

  it("truncates a huge body instead of producing a report nobody can open", () => {
    const big = "x".repeat(250_000);
    const html = formatHtml(
      runResult({
        passed: 1,
        results: [
          {
            name: "Big",
            request: { method: "GET", url: "https://api.test/big" },
            ok: true,
            response: { status: 200, statusText: "OK", durationMs: 3, headers: {}, bodyText: big },
            assertions: [],
          },
        ],
      }),
      "/w",
      at,
    );
    expect(html).toMatch(/truncated \(50000 more characters\)/);
    expect(html.length).toBeLessThan(230_000);
  });

  it("reports an empty run and unresolved secrets as warnings, not as a pass", () => {
    const html = formatHtml(runResult({ missingSecrets: ["token"] }), "/w", at);
    expect(html).toContain('<body class="fail">');
    expect(html).toContain("No requests ran.");
    expect(html).toContain("Unresolved secrets");
    expect(html).toContain("token");
  });

  it("surfaces skipped and deselected counts when a run was filtered or bailed", () => {
    const html = formatHtml(runResult({ skipped: 2, deselected: 3 }), "/w", at);
    expect(html).toContain(">skipped<");
    expect(html).toContain(">deselected<");
  });
});
