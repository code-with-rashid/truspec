import type { WorkspaceRunResult } from "@truspec/core/workspace";
import { describe, expect, it } from "vitest";
import { formatContract, formatCoverage, formatHuman, formatJunit } from "../src/output";
import { formatHtml } from "../src/report-html";

function hasXmlForbiddenChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 8 || c === 11 || c === 12 || (c >= 14 && c <= 31)) return true; // C0 except tab/LF/CR
  }
  return false;
}

describe("formatJunit", () => {
  it("strips XML-illegal control chars (e.g. from a hostile server's header value)", () => {
    const ctrl = String.fromCharCode(0, 27, 8); // NUL, ESC, BS — illegal in XML 1.0 even as entities
    const result: WorkspaceRunResult = {
      passed: 0,
      failed: 1, skipped: 0,
      ok: false,
      missingSecrets: [],
      results: [
        {
          name: `weird${ctrl}name`,
          request: { method: "GET", url: "http://x" },
          ok: false,
          assertions: [{ type: "header", ok: false, message: `header "X-Foo": bad${ctrl}val` }],
        },
      ],
    };
    expect(hasXmlForbiddenChar(ctrl)).toBe(true); // sanity: the input genuinely has forbidden chars

    const xml = formatJunit(result, "/tmp");
    expect(hasXmlForbiddenChar(xml)).toBe(false); // report stays parseable
    expect(xml).toContain("badval"); // controls dropped, printable text on both sides survives
    expect(xml).toContain("weirdname");
    expect(xml).toContain("<failure");
  });

  it("still escapes XML metacharacters", () => {
    const result: WorkspaceRunResult = {
      passed: 0,
      failed: 1, skipped: 0,
      ok: false,
      missingSecrets: [],
      results: [
        {
          name: 'name <with> & "quotes"',
          request: { method: "GET", url: "http://x" },
          ok: false,
          assertions: [{ type: "body", ok: false, message: "a < b & c" }],
        },
      ],
    };
    const xml = formatJunit(result, "/tmp");
    expect(xml).toContain("name &lt;with&gt; &amp; &quot;quotes&quot;");
    expect(xml).not.toContain("<with>");
  });
});

describe("reporting a file that did not parse", () => {
  const result = {
    results: [
      {
        name: "Get pet",
        ok: true,
        assertions: [],
        filePath: "/w/get.tspec.yaml",
        request: { method: "GET", url: "http://x", headers: {} },
        response: { status: 200, statusText: "OK", headers: {}, bodyText: "{}", durationMs: 5 },
      },
    ],
    passed: 1,
    failed: 0,
    skipped: 0,
    ok: false,
    missingSecrets: [],
    parseErrors: [{ file: "/w/broken.tspec.yaml", error: "Invalid TruSpec request:\n  <root>: Unrecognized key(s) in object: 'headrs' (did you mean 'headers'?)" }],
  } as unknown as WorkspaceRunResult;

  it("names the file and the suggestion in the human report", () => {
    const out = formatHuman(result, "/w");
    expect(out).toContain("could not parse  (broken.tspec.yaml)");
    expect(out).toContain("did you mean 'headers'?");
    expect(out).toContain("1 unparseable");
  });

  it("emits it as a FAILING JUnit case, so CI cannot read the report as clean", () => {
    const xml = formatJunit(result, "/w");
    // Omitting it would leave `tests="1" failures="0"` — a green gate over an unreadable file.
    expect(xml).toContain('tests="2" failures="1"');
    expect(xml).toContain('classname="broken.tspec.yaml"');
    expect(xml).toMatch(/<failure message="Invalid TruSpec request/);
  });

  it("shows it as a card in the HTML report rather than dropping it", () => {
    const html = formatHtml(result, "/w", new Date(0));
    expect(html).toContain("could not parse");
    expect(html).toContain("broken.tspec.yaml");
    expect(html).toContain("<b>1</b><span>unparseable</span>");
    expect(html).toContain('<body class="fail">');
  });
});

describe("formatCoverage explains an uncovered operation", () => {
  it("annotates the one that has a request but no assertions, and leaves the other bare", () => {
    const text = formatCoverage(
      {
        total: 2,
        covered: [],
        uncovered: ["GET /health", "GET /pets/{id}"],
        unasserted: [{ op: "GET /health", request: "Health", filePath: "/w/api/health.tspec.yaml" }],
        percent: 0,
        ok: false,
      },
      "/w",
    );
    expect(text).toContain('✗ GET /health  — "Health" (api/health.tspec.yaml) has no assertions');
    expect(text).toMatch(/✗ GET \/pets\/\{id\}$/m);
  });

  it("still renders a report from an older version, which has no `unasserted`", () => {
    const text = formatCoverage({ total: 1, covered: [], uncovered: ["GET /x"], percent: 0, ok: false }, "/w");
    expect(text).toContain("✗ GET /x");
    expect(text).not.toContain("has no assertions");
  });
});

describe("formatContract never claims conformance that did not happen", () => {
  const base = { specOperations: 1, conformed: [], violations: [], skipped: [], untested: [], ok: true };

  it("says nothing was validated, rather than 'all conform', when nothing was", () => {
    // The old output printed "All 1 tested operation(s) conform to the spec." directly beneath a
    // header saying 0/1 conform — two contradictory lines, the reassuring one being false.
    const text = formatContract({
      ...base,
      skipped: [{ op: "GET /pets/{id}", message: "no schema", requestFailed: true, status: 500 }],
    });
    expect(text).toContain("No operation was validated against the spec.");
    expect(text).not.toContain("conform to the spec.\n");
    expect(text).not.toMatch(/All \d+ tested operation/);
  });

  it("distinguishes a failed request from an undocumented status", () => {
    const failed = formatContract({
      ...base,
      skipped: [{ op: "GET /a", message: "m", requestFailed: true, status: 500 }],
    });
    expect(failed).toContain("the request failed (500)");
    expect(failed).toContain("truspec run");

    const undocumented = formatContract({ ...base, skipped: [{ op: "GET /a", message: "m" }] });
    expect(undocumented).toContain("the spec declares no schema for the response status");
    expect(undocumented).not.toContain("the request failed");
  });

  it("reports a partial result as partial", () => {
    const text = formatContract({
      ...base,
      conformed: ["GET /a"],
      skipped: [{ op: "GET /b", message: "m" }],
    });
    expect(text).toContain("1 operation(s) conform to the spec; 1 could not be validated.");
  });

  it("still says all conform when they all did", () => {
    expect(formatContract({ ...base, conformed: ["GET /a", "GET /b"] })).toContain(
      "All 2 tested operation(s) conform to the spec.",
    );
  });

  it("leads with the violation count when there is one", () => {
    const text = formatContract({
      ...base,
      ok: false,
      violations: [{ op: "GET /a", status: 200, message: "schema: bad" }],
    });
    expect(text).toContain("Contract violations: 1.");
  });
});
