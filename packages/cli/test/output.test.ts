import type { WorkspaceRunResult } from "@truspec/core/workspace";
import { describe, expect, it } from "vitest";
import { formatJunit } from "../src/output";

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
      failed: 1,
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
      failed: 1,
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
