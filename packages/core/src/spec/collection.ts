import type { TruSpecRequest } from "../format/types";

/** An operation referenced by a collection request (via its `spec` link). */
export interface CollectionOp {
  name: string;
  filePath?: string;
  ref: { operationId?: string; operation?: string };
  hasAssertions: boolean;
  /** Query parameter names the request provides (from `query` and the URL). */
  queryParams: string[];
  /** Header names the request sets, lowercased. */
  headerNames: string[];
  hasBody: boolean;
  /**
   * The JSON request body, as authored — `{{vars}}` still in it.
   *
   * `drift` validates this against the spec's `requestBody` schema, which is how a *newly required
   * field* is caught: the most common breaking change an API makes, and one that nothing in this
   * tool used to notice. It stays uninterpolated on purpose; the caller drops any violation a
   * template could explain rather than resolving values it cannot know at lint time.
   */
  jsonBody?: unknown;
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
      headerNames: Object.keys(req.headers ?? {}).map((h) => h.toLowerCase()),
      hasBody: req.body !== undefined && req.body.type !== "none",
      ...(req.body?.type === "json" ? { jsonBody: req.body.content } : {}),
    });
  }
  return out;
}
