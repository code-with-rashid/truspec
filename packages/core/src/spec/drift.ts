import type { CollectionOp } from "./collection";
import type { SpecOperation } from "./openapi";

export interface DriftReport {
  specOperations: number;
  collectionOperations: number;
  /** In the spec but not referenced by any request (new/untracked endpoints). */
  added: string[];
  /** Referenced by a request but absent from the spec (stale/removed endpoints). */
  removed: string[];
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
  for (const c of colOps) {
    const match = ops.find((o) => refMatchesOp(c.ref, o));
    if (match) referenced.add(match.key);
    else removed.push(c.ref.operation ?? c.ref.operationId ?? c.name);
  }
  const added = ops.filter((o) => !referenced.has(o.key)).map((o) => o.key);
  return {
    specOperations: ops.length,
    collectionOperations: colOps.length,
    added: added.sort(),
    removed: removed.sort(),
    ok: added.length === 0 && removed.length === 0,
  };
}
