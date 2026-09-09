import type { CollectionOp } from "./collection";
import { refMatchesOp } from "./drift";
import type { SpecOperation } from "./openapi";

export interface CoverageReport {
  total: number;
  /** Operations with at least one request that also has assertions. */
  covered: string[];
  uncovered: string[];
  /**
   * The subset of `uncovered` that a request *does* point at, but which asserts nothing.
   *
   * Uncovered for a different reason and with a different fix: an operation nothing points at
   * needs a request written; this one needs an assertion added to a file that already exists.
   * Reporting both as a bare "uncovered" line is what makes a collection with a request per
   * operation still read as 0%, with nothing on screen to say why.
   *
   * Optional so an older report — a `--json` file from a previous version, say — still satisfies
   * the type; every producer here always sets it.
   */
  unasserted?: Array<{ op: string; request: string; filePath?: string }>;
  percent: number;
  ok: boolean;
}

/**
 * Coverage = the share of spec operations exercised by a request *with assertions*.
 * `minPercent` sets the pass threshold (0 means report-only).
 */
export function computeCoverage(
  ops: SpecOperation[],
  colOps: CollectionOp[],
  minPercent = 0,
): CoverageReport {
  const covered: string[] = [];
  const uncovered: string[] = [];
  const unasserted: Array<{ op: string; request: string; filePath?: string }> = [];
  for (const op of ops) {
    const linked = colOps.filter((c) => refMatchesOp(c.ref, op));
    if (linked.some((c) => c.hasAssertions)) {
      covered.push(op.key);
      continue;
    }
    uncovered.push(op.key);
    // Linked but silent: name the request so the fix lands in the right file.
    const first = linked[0];
    if (first) {
      unasserted.push({
        op: op.key,
        request: first.name,
        ...(first.filePath ? { filePath: first.filePath } : {}),
      });
    }
  }
  const percent = ops.length === 0 ? 100 : Math.round((covered.length / ops.length) * 100);
  return {
    total: ops.length,
    covered: covered.sort(),
    uncovered: uncovered.sort(),
    unasserted: unasserted.sort((a, b) => a.op.localeCompare(b.op)),
    percent,
    ok: percent >= minPercent,
  };
}
