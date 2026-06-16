import { readFileSync } from "node:fs";
import { parse } from "../format";
import { discoverRequests } from "../workspace/discover";
import { type CollectionOp, collectionOperations } from "./collection";
import { computeCoverage, type CoverageReport } from "./coverage";
import { computeDrift, type DriftReport } from "./drift";
import { type LiveProbeOptions, probeLiveOperations } from "./live";
import { type OpenApiSummary, parseOpenApi } from "./openapi";

export function loadOpenApi(specPath: string): OpenApiSummary {
  return parseOpenApi(readFileSync(specPath, "utf8"));
}

/** Discover and map every request under `dir` to its referenced operation. */
export function loadCollectionOperations(dir: string): CollectionOp[] {
  const reqs = discoverRequests(dir).map((file) => ({
    file,
    req: parse.request.parse(readFileSync(file, "utf8")),
  }));
  return collectionOperations(reqs);
}

export function driftReport(dir: string, specPath: string): DriftReport {
  return computeDrift(loadOpenApi(specPath).operations, loadCollectionOperations(dir));
}

/** Drift report that also probes a running API for missing operations. */
export async function liveDriftReport(
  dir: string,
  specPath: string,
  baseUrl: string,
  opts: LiveProbeOptions = {},
): Promise<DriftReport> {
  const summary = loadOpenApi(specPath);
  const report = computeDrift(summary.operations, loadCollectionOperations(dir));
  const probe = await probeLiveOperations(summary.operations, baseUrl, opts);
  report.liveMissing = probe.missing;
  report.ok = report.ok && probe.missing.length === 0;
  return report;
}

export function coverageReport(dir: string, specPath: string, minPercent = 0): CoverageReport {
  return computeCoverage(loadOpenApi(specPath).operations, loadCollectionOperations(dir), minPercent);
}
