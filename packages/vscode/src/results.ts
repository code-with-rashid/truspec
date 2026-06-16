import type { CoverageReport, DriftReport } from "@truspec/core/spec";
import type { WorkspaceRunResult } from "@truspec/core/workspace";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ENTITIES[c] ?? c);

const statusClass = (c: number): string =>
  c >= 500 ? "s5" : c >= 400 ? "s4" : c >= 300 ? "s3" : "s2";

const CSS = `
:root{--ink:#0a0b0d;--panel:#15181d;--line:#23262d;--text:#e8e9eb;--dim:#888e98;--lime:#c8ff32;--green:#34d977;--red:#ff5b5b;--amber:#ffb22e;--cyan:#45c4ff}
*{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--text);font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:13px;line-height:1.5;padding:14px}
h1{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--dim);font-weight:600;border-bottom:1px solid var(--line);padding-bottom:8px;margin:0 0 12px}
.brand{color:var(--lime)}
.row{display:flex;gap:9px;align-items:center;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--line);border-radius:6px;margin-bottom:6px;background:var(--panel)}
.row.bad{border-color:#5a2b30}
.tick{font-weight:700}.ok .tick{color:var(--green)}.bad .tick{color:var(--red)}
.name{flex:1}
.pill{border:1px solid currentColor;border-radius:5px;padding:1px 7px;font-size:11px;font-weight:600}
.s2{color:var(--green)}.s3{color:var(--cyan)}.s4{color:var(--amber)}.s5{color:var(--red)}
.time{color:var(--lime)}
.fail{flex-basis:100%;color:var(--red);font-size:11.5px;padding-left:18px}
.sum{margin-top:10px;color:var(--dim)}
.bar{height:10px;background:var(--panel);border:1px solid var(--line);border-radius:6px;overflow:hidden;margin:6px 0}
.fill{height:100%;background:linear-gradient(90deg,var(--green),var(--lime))}
.op{padding:4px 8px;border-radius:4px;background:var(--panel);margin-bottom:4px;font-size:12px}
.amber{color:var(--amber)}.red{color:var(--red)}
.lbl{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:1px;margin:14px 0 6px}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><h1><span class="brand">◢◤ TruSpec</span> · ${esc(title)}</h1>${body}</body></html>`;
}

export function renderResults(result: WorkspaceRunResult): string {
  const rows = result.results
    .map((r) => {
      const meta = r.response
        ? `<span class="pill ${statusClass(r.response.status)}">${r.response.status}</span><span class="time">${r.response.durationMs}ms</span>`
        : "";
      const fails = r.ok
        ? ""
        : [r.error, ...r.assertions.filter((a) => !a.ok).map((a) => a.message)]
            .filter(Boolean)
            .map((m) => `<span class="fail">✗ ${esc(String(m))}</span>`)
            .join("");
      return `<div class="row ${r.ok ? "ok" : "bad"}"><span class="tick">${r.ok ? "✓" : "✗"}</span><span class="name">${esc(r.name)}</span>${meta}${fails}</div>`;
    })
    .join("");
  return page("run", `${rows || '<div class="sum">no requests.</div>'}<div class="sum">${result.passed} passed · ${result.failed} failed</div>`);
}

export function renderDrift(report: DriftReport, spec: string): string {
  const group = (label: string, items: string[], sym: string, cls: string): string =>
    items.length > 0
      ? `<div class="lbl">${label} · ${items.length}</div>${items.map((o) => `<div class="op ${cls}">${sym} ${esc(o)}</div>`).join("")}`
      : "";
  const body =
    `<div class="lbl">spec</div><div class="op">${esc(spec)}</div>` +
    group("untracked in collection", report.added, "+", "amber") +
    group("stale (not in spec)", report.removed, "-", "red") +
    group("changed", report.changed, "~", "amber") +
    (report.liveMissing ? group("missing from live API", report.liveMissing, "x", "red") : "") +
    (report.ok
      ? `<div class="sum">No drift — collection matches the spec.</div>`
      : `<div class="sum">Drift: ${report.added.length} untracked · ${report.removed.length} stale · ${report.changed.length} changed</div>`);
  return page("drift", body);
}

export function renderCoverage(report: CoverageReport, spec: string): string {
  const uncovered = report.uncovered.map((o) => `<div class="op red">✗ ${esc(o)}</div>`).join("");
  const body =
    `<div class="lbl">spec</div><div class="op">${esc(spec)}</div>` +
    `<div class="lbl">coverage · ${report.percent}%</div>` +
    `<div class="bar"><div class="fill" style="width:${report.percent}%"></div></div>` +
    `<div class="sum">${report.covered.length}/${report.total} operations tested</div>` +
    (uncovered ? `<div class="lbl">uncovered</div>${uncovered}` : "");
  return page("coverage", body);
}
