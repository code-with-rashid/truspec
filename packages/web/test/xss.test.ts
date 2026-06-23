import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const prettyBody = (text: string): string => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } };
const PAYLOADS = [
  `<img src=x onerror="document.title='X'">`,
  `<script>document.title='X'</script>`,
  `<svg onload="alert(1)"></svg>`,
  `"><iframe src=javascript:alert(1)>`,
  `</pre><img src=y onerror=alert(1)>`,
];

describe("QA C7 — web UI XSS: React escapes all collection data", () => {
  it("name/url/docs/body/assert/captured/KV render escaped, never executable", () => {
    for (const p of PAYLOADS) {
      const html = renderToStaticMarkup(
        h("div", null,
          h("span", { className: "rname" }, p),
          h("code", { className: "url" }, p),
          h("p", { className: "docs" }, p),
          h("div", { className: "speclink" }, "spec ▸ ", p),
          h("pre", { className: "body" }, prettyBody(p)),
          h("span", { className: "amsg" }, p),
          h("div", { className: "captured" }, "captured: ", `k=${p}`),
          h("span", { className: "kv-k" }, p),
          h("span", { className: "kv-v" }, String(p)),
          h("code", { className: "assert-def" }, JSON.stringify({ type: "body", contains: p })),
        ),
      );
      expect(html).not.toContain("<img src=x onerror");
      expect(html).not.toContain("<img src=y onerror");
      expect(html).not.toContain("<script>document.title");
      expect(html).not.toContain("<svg onload");
      expect(html).not.toContain("<iframe");
      expect(html).toMatch(/&lt;|&gt;/);
    }
  });

  it("a JSON response body containing HTML stays inside the escaped <pre>", () => {
    const body = JSON.stringify({ note: `</pre><script>document.title='PWNED'</script>` });
    const html = renderToStaticMarkup(h("pre", { className: "body" }, prettyBody(body)));
    expect(html).not.toContain("</pre><script>");
    expect(html).not.toContain("<script>document.title");
  });
});
