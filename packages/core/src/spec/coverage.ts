import type { CollectionOp } from "./collection";
import { refMatchesOp } from "./drift";
import type { SpecOperation } from "./openapi";

export interface CoverageReport {
  total: number;
  /** Operations with at least one request that also has assertions. */
  covered: string[];
  uncovered: string[];
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
  for (const op of ops) {
    const isCovered = colOps.some((c) => c.hasAssertions && refMatchesOp(c.ref, op));
    (isCovered ? covered : uncovered).push(op.key);
  }
  const percent = ops.length === 0 ? 100 : Math.round((covered.length / ops.length) * 100);
  return {
    total: ops.length,
    covered: covered.sort(),
    uncovered: uncovered.sort(),
    percent,
    ok: percent >= minPercent,
  };
}
