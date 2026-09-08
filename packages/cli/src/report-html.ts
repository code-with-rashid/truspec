import { relative } from "node:path";
import type { WorkspaceRunResult } from "@truspec/core/workspace";

/**
 * A single self-contained HTML page for a run.
 *
 * CI needs an artifact a human opens and understands in five seconds — newman and Bruno both ship
 * one. Constraints that shape this file: no external CSS/JS/fonts (it has to render from a
 * `file://` path, an artifact viewer, or a strict CSP), no scripts at all (`<details>` does the
 * expanding), and *everything* interpolated is escaped, because response bodies, headers and
 * assertion messages are attacker-controlled data.
 */
export function formatHtml(result: WorkspaceRunResult, cwd: string, now = new Date()): string {
  const total = result.results.length;
  const totalMs = result.results.reduce((sum, r) => sum + (r.response?.durationMs ?? 0), 0);
  const verdict = result.ok && total > 0 ? "pass" : "fail";

  const cards = result.results.map((r) => {
    const where = esc(r.filePath ? relative(cwd, r.filePath) : r.name);
    const failed = r.assertions.filter((a) => !a.ok);
    const passed = r.assertions.filter((a) => a.ok);
    return `
    <article class="case ${r.ok ? "ok" : "bad"}">
      <header>
        <span class="badge">${r.ok ? "PASS" : "FAIL"}</span>
        <h2>${esc(r.name)}</h2>
        <code class="where">${where}</code>
        <span class="grow"></span>
        ${r.response ? `<span class="status s${String(r.response.status)[0]}">${r.response.status}</span><span class="ms">${r.response.durationMs} ms</span>` : ""}
      </header>
      <p class="req"><span class="method">${esc(r.request.method)}</span> <code>${esc(r.request.url)}</code></p>
      ${r.error ? `<p class="error">${esc(r.error)}</p>` : ""}
      ${
        r.assertions.length > 0
          ? `<ul class="assertions">${[...failed, ...passed]
              .map(
                (a) =>
                  `<li class="${a.ok ? "ok" : "bad"}"><span aria-hidden="true">${a.ok ? "✓" : "✗"}</span> <span class="type">${esc(a.type)}</span> ${esc(a.message)}</li>`,
              )
              .join("")}</ul>`
          : `<p class="muted">no assertions</p>`
      }
      ${
        r.captured && Object.keys(r.captured).length > 0
          ? `<p class="captured">captured: ${Object.entries(r.captured)
              .map(([k, v]) => `<code>${esc(k)}=${esc(String(v))}</code>`)
              .join(" ")}</p>`
          : ""
      }
      ${r.response ? responseDetails(r.response) : ""}
    </article>`;
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TruSpec run — ${result.passed}/${total} passed</title>
<style>${CSS}</style>
</head>
<body class="${verdict}">
<main>
  <h1>TruSpec run report</h1>
  <p class="meta">${esc(now.toISOString())} · <code>${esc(cwd)}</code></p>
  <div class="summary">
    <div class="stat big ${verdict}"><b>${verdict === "pass" ? "PASS" : "FAIL"}</b><span>result</span></div>
    <div class="stat"><b>${result.passed}</b><span>passed</span></div>
    <div class="stat"><b>${result.failed}</b><span>failed</span></div>
    ${result.skipped > 0 ? `<div class="stat"><b>${result.skipped}</b><span>skipped</span></div>` : ""}
    ${result.deselected ? `<div class="stat"><b>${result.deselected}</b><span>deselected</span></div>` : ""}
    <div class="stat"><b>${totalMs}</b><span>total ms</span></div>
  </div>
  ${
    result.missingSecrets.length > 0
      ? `<p class="warn">Unresolved secrets: ${result.missingSecrets.map((s) => `<code>${esc(s)}</code>`).join(", ")}</p>`
      : ""
  }
  ${total === 0 ? `<p class="warn">No requests ran.</p>` : cards.join("")}
</main>
</body>
</html>
`;
}

function responseDetails(response: {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
}): string {
  const headers = Object.entries(response.headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  // Bodies can be megabytes; a report nobody can open is no report. Truncate with a clear marker.
  const body = truncate(response.bodyText, MAX_BODY_CHARS);
  return `      <details>
        <summary>response · ${response.status} ${esc(response.statusText)}</summary>
        <h3>headers</h3>
        <pre>${esc(headers)}</pre>
        <h3>body</h3>
        <pre>${esc(body)}</pre>
      </details>`;
}

/** Keep a report openable in a browser: 200 KB of body per request is already generous. */
const MAX_BODY_CHARS = 200_000;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n… truncated (${s.length - max} more characters)`;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape every one of the five characters that can break out of text or an attribute value.
 * Response bodies and header values are attacker-controlled; this is the only thing standing
 * between a hostile `<script>` in a body and a CI artifact that runs it.
 */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #ffffff; --panel: #f6f7f9; --line: #dfe3e8; --text: #1b1f26; --dim: #5b6270;
  --pass: #1a7f4b; --fail: #c0392f; --accent: #2b5fd9;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14161b; --panel: #1b1f26; --line: #2b303a; --text: #d5d9e0; --dim: #949aa5;
    --pass: #84c98d; --fail: #e57689; --accent: #79c0dc;
  }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 20px 64px; background: var(--bg); color: var(--text); }
main { max-width: 980px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0 0 4px; }
.meta { color: var(--dim); font-size: 12px; margin: 0 0 20px; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.summary { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 24px; }
.stat {
  min-width: 92px; padding: 10px 14px; border: 1px solid var(--line);
  border-radius: 8px; background: var(--panel);
}
.stat b { display: block; font-size: 20px; line-height: 1.2; }
.stat span { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.stat.big.pass b { color: var(--pass); }
.stat.big.fail b { color: var(--fail); }
.warn { padding: 10px 14px; border-left: 3px solid var(--fail); background: var(--panel); }
.case {
  border: 1px solid var(--line); border-left-width: 3px; border-radius: 8px;
  background: var(--panel); padding: 14px 16px; margin-bottom: 12px;
}
.case.ok { border-left-color: var(--pass); }
.case.bad { border-left-color: var(--fail); }
.case header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.case h2 { font-size: 15px; margin: 0; }
.badge { font-size: 10px; font-weight: 700; letter-spacing: .06em; padding: 2px 6px; border-radius: 4px; }
.case.ok .badge { background: var(--pass); color: var(--bg); }
.case.bad .badge { background: var(--fail); color: var(--bg); }
.where { color: var(--dim); font-size: 11.5px; }
.grow { flex: 1; }
.status { font-weight: 700; font-size: 13px; }
.status.s2 { color: var(--pass); } .status.s4, .status.s5 { color: var(--fail); }
.ms { color: var(--dim); font-size: 11.5px; }
.req { margin: 8px 0; font-size: 12.5px; }
.method { font-weight: 700; color: var(--accent); }
.error { color: var(--fail); font-size: 12.5px; margin: 6px 0; }
.assertions { list-style: none; margin: 8px 0 0; padding: 0; font-size: 12.5px; }
.assertions li { padding: 2px 0; }
.assertions li.ok { color: var(--dim); }
.assertions li.bad { color: var(--fail); }
.assertions .type { display: inline-block; min-width: 66px; color: var(--dim); }
.captured { font-size: 12px; color: var(--dim); margin: 8px 0 0; }
.muted { color: var(--dim); font-size: 12.5px; }
details { margin-top: 10px; }
summary { cursor: pointer; font-size: 12.5px; color: var(--dim); }
details h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); margin: 10px 0 4px; }
pre {
  margin: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--bg); font-size: 12px; line-height: 1.5;
  overflow-x: auto; white-space: pre-wrap; word-break: break-word;
}
`;
