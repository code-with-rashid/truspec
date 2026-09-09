import type { WorkspaceRunResult } from "@truspec/core/workspace";
import { describe, expect, it } from "vitest";
import { formatHuman, formatJunit } from "../src/output";
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
