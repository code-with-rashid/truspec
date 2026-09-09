import { relative } from "node:path";
import type { ContractReport, CoverageReport, DriftReport } from "@truspec/core/spec";
import type { WorkspaceRunResult } from "@truspec/core/workspace";
import { toPosixPath } from "@truspec/core/workspace";

export function formatJson(result: WorkspaceRunResult): string {
  return JSON.stringify(result, null, 2);
}

/** Human-readable, color-free summary suitable for terminals and CI logs. */
export function formatHuman(result: WorkspaceRunResult, cwd: string): string {
  const lines: string[] = [];
  for (const r of result.results) {
    const where = r.filePath ? toPosixPath(relative(cwd, r.filePath)) : r.name;
    const meta = r.response ? `  ${r.response.status} ${r.response.durationMs}ms` : "";
    // Without the iteration number, a data-driven run's log is N identical-looking lines and a
    // failure cannot be traced back to the row that caused it.
    const iter = r.iteration !== undefined ? `[${r.iteration}] ` : "";
    lines.push(`${iter}${r.ok ? "✓" : "✗"} ${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${where})${meta}`);
    if (r.error) lines.push(`      error: ${r.error}`);
    for (const a of r.assertions) {
      if (!a.ok) lines.push(`      ✗ ${a.message}`);
    }
  }
  // Before the summary, and never silently: a file that did not parse ran no request at all, so it
  // appears in no other line of this report.
  for (const e of result.parseErrors ?? []) {
    lines.push(`✗ ERROR  could not parse  (${toPosixPath(relative(cwd, e.file))})`);
    for (const line of e.error.split("\n")) lines.push(`      ${line.trim()}`);
  }
  lines.push("");
  const parts = [`${result.passed} passed`, `${result.failed} failed`];
  if (result.iterations && result.iterations > 1) parts.push(`${result.iterations} iterations`);
  // `bail` and `--grep`/`--tag` both shrink what ran; say so, or a small "total" looks like a
  // missing-file bug rather than the selection the user asked for.
  if (result.skipped > 0) parts.push(`${result.skipped} skipped (bailed)`);
  if (result.parseErrors?.length) parts.push(`${result.parseErrors.length} unparseable`);
  parts.push(`${result.results.length} total`);
  if (result.deselected) parts.push(`${result.deselected} deselected`);
  lines.push(parts.join(", "));
  return lines.join("\n");
}

export function formatDrift(report: DriftReport): string {
  const lines: string[] = [];
  lines.push(
    `Spec operations: ${report.specOperations}   Collection operations: ${report.collectionOperations}`,
  );
  if (report.added.length > 0) {
    lines.push("", `Untracked in collection (${report.added.length}):`);
    for (const k of report.added) lines.push(`  + ${k}`);
  }
  if (report.removed.length > 0) {
    lines.push("", `Stale — not in the spec (${report.removed.length}):`);
    for (const k of report.removed) lines.push(`  - ${k}`);
  }
  if (report.changed.length > 0) {
    lines.push("", `Changed (${report.changed.length}):`);
    for (const k of report.changed) lines.push(`  ~ ${k}`);
  }
  if (report.liveMissing && report.liveMissing.length > 0) {
    lines.push("", `Missing from live API (${report.liveMissing.length}):`);
    for (const k of report.liveMissing) lines.push(`  x ${k}`);
  }
  lines.push("");
  if (report.ok) {
    lines.push("No drift — collection matches the spec.");
  } else {
    const parts = [
      `${report.added.length} untracked`,
      `${report.removed.length} stale`,
      `${report.changed.length} changed`,
    ];
    if (report.liveMissing) parts.push(`${report.liveMissing.length} missing live`);
    lines.push(`Drift detected: ${parts.join(", ")}.`);
  }
  return lines.join("\n");
}

export function formatContract(report: ContractReport): string {
  const lines: string[] = [];
  const tested = report.conformed.length + report.violations.length + report.skipped.length;
  lines.push(`Contract: ${report.conformed.length}/${tested} tested operations conform to the spec`);
  for (const k of report.conformed) lines.push(`  ✓ ${k}`);
  if (report.violations.length > 0) {
    lines.push("", `Violations (${report.violations.length}):`);
    for (const v of report.violations) lines.push(`  ✗ ${v.op}  →  ${v.message}`);
  }
  if (report.skipped.length > 0) {
    lines.push("", `Skipped — spec declares no schema for the response status (${report.skipped.length}):`);
    for (const s of report.skipped) lines.push(`  ~ ${s.op}`);
  }
  if (report.untested.length > 0) {
    lines.push("", `Untested — no request exercises these (${report.untested.length}, see \`coverage\`):`);
    for (const k of report.untested) lines.push(`  – ${k}`);
  }
  lines.push("");
  lines.push(
    report.ok
      ? `All ${tested} tested operation(s) conform to the spec.`
      : `Contract violations: ${report.violations.length}.`,
  );
  return lines.join("\n");
}

export function formatCoverage(report: CoverageReport, cwd = process.cwd()): string {
  const lines: string[] = [];
  lines.push(`Coverage: ${report.percent}% (${report.covered.length}/${report.total} operations tested)`);
  // An operation a request points at but never asserts on is uncovered for a different reason
  // than one nothing points at — and needs a different fix. Say which, and where.
  const silent = new Map(report.unasserted?.map((u) => [u.op, u]) ?? []);
  if (report.uncovered.length > 0) {
    lines.push("", `Uncovered (${report.uncovered.length}):`);
    for (const k of report.uncovered) {
      const u = silent.get(k);
      if (!u) {
        lines.push(`  ✗ ${k}`);
        continue;
      }
      const where = u.filePath ? ` (${toPosixPath(relative(cwd, u.filePath))})` : "";
      lines.push(`  ✗ ${k}  — "${u.request}"${where} has no assertions; a request that asserts nothing tests nothing`);
    }
  }
  return lines.join("\n");
}

const XML_ESCAPES: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  '"': "&quot;",
  "'": "&apos;",
};

// XML 1.0 forbids C0 control characters (except tab, LF, CR) outright — they are
// illegal even as numeric entities. A hostile/buggy server's header value reaches
// the JUnit report via an assertion message, so strip them or the report won't parse.
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching forbidden XML control chars
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function escapeXml(s: string): string {
  return s.replace(XML_INVALID, "").replace(/[<>&"']/g, (c) => XML_ESCAPES[c] ?? c);
}

/** JUnit XML — one testcase per request — for CI test reporters. */
export function formatJunit(result: WorkspaceRunResult, cwd: string): string {
  const cases = result.results.map((r) => {
    // A JUnit reporter keys on name+classname; without the iteration, N rows collapse into one
    // testcase and a reporter silently shows only the last outcome.
    const name = escapeXml(r.iteration !== undefined ? `${r.name} [${r.iteration}]` : r.name);
    const classname = escapeXml(r.filePath ? toPosixPath(relative(cwd, r.filePath)) : r.name);
    const time = ((r.response?.durationMs ?? 0) / 1000).toFixed(3);
    if (r.ok) return `    <testcase name="${name}" classname="${classname}" time="${time}"/>`;
    const reasons = [
      ...(r.error ? [r.error] : []),
      ...r.assertions.filter((a) => !a.ok).map((a) => a.message),
    ].join("; ");
    return `    <testcase name="${name}" classname="${classname}" time="${time}">\n      <failure message="${escapeXml(reasons || "failed")}"/>\n    </testcase>`;
  });
  // A file that did not parse has to appear as a failing case: a CI report that simply omits it
  // reads as clean, which is the one outcome a gate must never produce.
  const parseCases = (result.parseErrors ?? []).map((e) => {
    const classname = escapeXml(toPosixPath(relative(cwd, e.file)));
    return `    <testcase name="${classname}" classname="${classname}" time="0.000">\n      <failure message="${escapeXml(e.error)}"/>\n    </testcase>`;
  });
  const total = result.results.length + parseCases.length;
  const failures = result.failed + parseCases.length;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${total}" failures="${failures}">`,
    `  <testsuite name="truspec" tests="${total}" failures="${failures}">`,
    ...cases,
    ...parseCases,
    "  </testsuite>",
    "</testsuites>",
  ].join("\n");
}
