import { relative } from "node:path";
import type { CoverageReport, DriftReport } from "@truspec/core/spec";
import type { WorkspaceRunResult } from "@truspec/core/workspace";

export function formatJson(result: WorkspaceRunResult): string {
  return JSON.stringify(result, null, 2);
}

/** Human-readable, color-free summary suitable for terminals and CI logs. */
export function formatHuman(result: WorkspaceRunResult, cwd: string): string {
  const lines: string[] = [];
  for (const r of result.results) {
    const where = r.filePath ? relative(cwd, r.filePath) : r.name;
    const meta = r.response ? `  ${r.response.status} ${r.response.durationMs}ms` : "";
    lines.push(`${r.ok ? "✓" : "✗"} ${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${where})${meta}`);
    if (r.error) lines.push(`      error: ${r.error}`);
    for (const a of r.assertions) {
      if (!a.ok) lines.push(`      ✗ ${a.message}`);
    }
  }
  lines.push("");
  lines.push(`${result.passed} passed, ${result.failed} failed, ${result.results.length} total`);
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
  lines.push("");
  lines.push(
    report.ok
      ? "No drift — collection matches the spec."
      : `Drift detected: ${report.added.length} untracked, ${report.removed.length} stale.`,
  );
  return lines.join("\n");
}

export function formatCoverage(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push(`Coverage: ${report.percent}% (${report.covered.length}/${report.total} operations tested)`);
  if (report.uncovered.length > 0) {
    lines.push("", `Uncovered (${report.uncovered.length}):`);
    for (const k of report.uncovered) lines.push(`  ✗ ${k}`);
  }
  return lines.join("\n");
}
