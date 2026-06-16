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
  for (const c of colOps) {
    const match = ops.find((o) => refMatchesOp(c.ref, o));
    if (!match) {
      removed.push(c.ref.operation ?? c.ref.operationId ?? c.name);
      continue;
    }
    referenced.add(match.key);
    for (const p of match.parameters) {
      if (p.in === "query" && p.required && !c.queryParams.includes(p.name)) {
        changed.push(`${match.key}: missing required query param '${p.name}'`);
      }
    }
  }
  const added = ops.filter((o) => !referenced.has(o.key)).map((o) => o.key);
  return {
    specOperations: ops.length,
    collectionOperations: colOps.length,
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
    ok: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}
