import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "../format";
import type { Vars } from "../runner";
import { discoverRequests } from "../workspace/discover";
import { runPath } from "../workspace/run";
import { type CollectionOp, collectionOperations } from "./collection";
import { computeCoverage, type CoverageReport } from "./coverage";
import { computeDrift, type DriftReport, refMatchesOp } from "./drift";
import { type LiveProbeOptions, probeLiveOperations } from "./live";
import { type OpenApiSummary, parseOpenApi } from "./openapi";

export function loadOpenApi(specPath: string): OpenApiSummary {
  if (!existsSync(specPath)) throw new Error(`Spec not found: ${specPath}`);
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

export interface ContractViolation {
  /** Operation key, e.g. "GET /pets/{id}". */
  op: string;
  status: number;
  /** The schema-assertion message (already lists the offending paths). */
  message: string;
  filePath?: string;
}

/** Conformance of a collection's *actual responses* to the OpenAPI response schemas. */
export interface ContractReport {
  specOperations: number;
  /** Operation keys whose response conformed to the spec. */
  conformed: string[];
  violations: ContractViolation[];
  /** Ran, but the spec declared no schema for the response status (not a failure). */
  skipped: { op: string; message: string }[];
  /** Spec operations no request exercises (informational — `coverage`/`drift` own this). */
  untested: string[];
  /** True when there are no violations. */
  ok: boolean;
}

export interface ContractRunOptions {
  env?: string;
  vars?: Vars;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
  cwd?: string;
  processEnv?: NodeJS.ProcessEnv;
}

/**
 * Run a collection and validate each response against its OpenAPI response schema.
 * Unlike `driftReport` (static), this sends requests — it shares `run`'s knobs (env,
 * secrets, timeout, injectable fetch). The gate is conformance only: `ok` is false iff a
 * response violates its schema. Untested/uncovered operations are reported but don't fail it.
 */
export async function contractReport(
  dir: string,
  specPath: string,
  opts: ContractRunOptions = {},
): Promise<ContractReport> {
  const cwd = opts.cwd ?? process.cwd();
  const absDir = resolve(cwd, dir);
  const absSpec = resolve(cwd, specPath);

  const summary = loadOpenApi(absSpec);
  const run = await runPath(absDir, { ...opts, cwd, spec: absSpec });

  // Map each request file to the operation it targets, and track which ops are referenced.
  const referenced = new Set<string>();
  const opByFile = new Map<string, string>();
  for (const c of loadCollectionOperations(absDir)) {
    const match = summary.operations.find((o) => refMatchesOp(c.ref, o));
    if (!match) continue;
    referenced.add(match.key);
    if (c.filePath) opByFile.set(c.filePath, match.key);
  }

  const conformed: string[] = [];
  const violations: ContractViolation[] = [];
  const skipped: { op: string; message: string }[] = [];
  for (const r of run.results) {
    const op = r.filePath ? opByFile.get(r.filePath) : undefined;
    const schema = r.assertions.find((a) => a.type === "schema");
    if (!op || !schema) continue; // unlinked request, or one with no schema verdict
    if (!schema.ok) {
      violations.push({ op, status: r.response?.status ?? 0, message: schema.message, filePath: r.filePath });
    } else if (schema.message.includes("conforms")) {
      conformed.push(op);
    } else {
      skipped.push({ op, message: schema.message }); // ok-but-not-validated (status undocumented)
    }
  }

  const untested = summary.operations.filter((o) => !referenced.has(o.key)).map((o) => o.key).sort();
  return {
    specOperations: summary.operations.length,
    conformed: conformed.sort(),
    violations: violations.sort((a, b) => a.op.localeCompare(b.op)),
    skipped: skipped.sort((a, b) => a.op.localeCompare(b.op)),
    untested,
    ok: violations.length === 0,
  };
}
