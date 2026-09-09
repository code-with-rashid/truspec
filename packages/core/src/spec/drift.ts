import type { CollectionOp } from "./collection";
import type { SpecOperation } from "./openapi";

export interface DriftReport {
  specOperations: number;
  collectionOperations: number;
  /** In the spec but not referenced by any request (new/untracked endpoints). */
  added: string[];
  /** Referenced by a request but absent from the spec (stale/removed endpoints). */
  removed: string[];
  /** Matched operations whose request no longer satisfies the spec (e.g. missing required param). */
  changed: string[];
  /** Spec operations missing from a probed live API (set only by `--live`). */
  liveMissing?: string[];
  /**
   * Which request file produced each `removed`/`changed` entry, keyed by the entry text.
   *
   * Drift names an operation; fixing it means editing a file. In a collection of any size,
   * "GET /search is stale" leaves the reader grepping for whichever of a hundred requests points
   * at it — a search the report can do for them, since it read the file to notice in the first
   * place. Absent for `added`, which by definition has no file yet.
   */
  sources?: Record<string, string[]>;
  ok: boolean;
}

function normalizeKey(operation: string): string {
  const parts = operation.trim().split(/\s+/);
  const method = parts[0];
  if (parts.length < 2 || method === undefined) return operation.trim();
  return `${method.toUpperCase()} ${parts.slice(1).join(" ")}`;
}

/** Does a request's spec reference identify the given spec operation? */
export function refMatchesOp(ref: CollectionOp["ref"], op: SpecOperation): boolean {
  if (ref.operationId && op.operationId) return ref.operationId === op.operationId;
  if (ref.operation) return normalizeKey(ref.operation) === op.key;
  return false;
}

/** Diff a collection against an OpenAPI spec: what's new, what's stale. */
export function computeDrift(ops: SpecOperation[], colOps: CollectionOp[]): DriftReport {
  const referenced = new Set<string>();
  const removed: string[] = [];
  const changed: string[] = [];
  const sources = new Map<string, Set<string>>();
  const note = (entry: string, c: CollectionOp): void => {
    if (!c.filePath) return;
    const set = sources.get(entry) ?? new Set<string>();
    set.add(c.filePath);
    sources.set(entry, set);
  };
  for (const c of colOps) {
    const match = ops.find((o) => refMatchesOp(c.ref, o));
    if (!match) {
      const entry = c.ref.operation ?? c.ref.operationId ?? c.name;
      removed.push(entry);
      note(entry, c);
      continue;
    }
    referenced.add(match.key);
    for (const p of match.parameters) {
      if (p.in === "query" && p.required && !c.queryParams.includes(p.name)) {
        const entry = `${match.key}: missing required query param '${p.name}'`;
        changed.push(entry);
        note(entry, c);
      }
    }
    if (match.requestBodyRequired && !c.hasBody) {
      const entry = `${match.key}: missing required request body`;
      changed.push(entry);
      note(entry, c);
    }
  }
  const added = ops.filter((o) => !referenced.has(o.key)).map((o) => o.key);
  return {
    specOperations: ops.length,
    collectionOperations: colOps.length,
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
    ...(sources.size > 0
      ? { sources: Object.fromEntries([...sources].map(([k, v]) => [k, [...v].sort()])) }
      : {}),
    ok: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}
