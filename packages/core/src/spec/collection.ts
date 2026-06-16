import type { TruSpecRequest } from "../format/types";

/** An operation referenced by a collection request (via its `spec` link). */
export interface CollectionOp {
  name: string;
  filePath?: string;
  ref: { operationId?: string; operation?: string };
  hasAssertions: boolean;
}

/** Map parsed requests to the operations they claim to exercise. */
export function collectionOperations(
  reqs: { file?: string; req: TruSpecRequest }[],
): CollectionOp[] {
  const out: CollectionOp[] = [];
  for (const { file, req } of reqs) {
    if (!req.spec) continue; // unlinked request — not mapped to an operation
    out.push({
      name: req.name,
      filePath: file,
      ref: { operationId: req.spec.operationId, operation: req.spec.operation },
      hasAssertions: req.assertions.length > 0,
    });
  }
  return out;
}
