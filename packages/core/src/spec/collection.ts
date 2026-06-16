import type { TruSpecRequest } from "../format/types";

/** An operation referenced by a collection request (via its `spec` link). */
export interface CollectionOp {
  name: string;
  filePath?: string;
  ref: { operationId?: string; operation?: string };
  hasAssertions: boolean;
  /** Query parameter names the request provides (from `query` and the URL). */
  queryParams: string[];
}

function requestQueryParams(req: TruSpecRequest): string[] {
  const names = new Set<string>();
  if (req.query) for (const k of Object.keys(req.query)) names.add(k);
  const qIndex = req.url.indexOf("?");
  if (qIndex !== -1) {
    for (const pair of req.url.slice(qIndex + 1).split("&")) {
      const name = pair.split("=")[0];
      if (name) names.add(name);
    }
  }
  return [...names];
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
      queryParams: requestQueryParams(req),
    });
  }
  return out;
}
