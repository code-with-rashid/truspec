import { relative } from "node:path";
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
