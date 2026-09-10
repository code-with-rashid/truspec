import type { CollectionOp } from "./collection";
import { validateAgainstSchema } from "./validate-response";
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

/**
 * Would a `{{template}}` explain this violation?
 *
 * A request body is authored with variables still in it, so validating it literally would report
 * `"{{petId}}"` as failing `type: integer` — a false alarm, and a drift check that cries wolf is a
 * drift check someone turns off. A violation is kept only when neither the offending value nor any
 * ancestor of it is a template string.
 *
 * A *missing required property* survives this by construction: its path names a key that is not
 * there, so there is no template to find — and no template could add one. That is exactly the
 * check worth having.
 */
function templated(body: unknown, path: string): boolean {
  const isTemplate = (v: unknown): boolean => typeof v === "string" && v.includes("{{");
  if (isTemplate(body)) return true;
  let node: unknown = body;
  for (const raw of path.split("/").filter(Boolean)) {
    if (node === null || typeof node !== "object") return false;
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    node = Array.isArray(node) ? node[Number(key)] : (node as Record<string, unknown>)[key];
    if (isTemplate(node)) return true;
  }
  return false;
}

export function refMatchesOp(ref: CollectionOp["ref"], op: SpecOperation): boolean {
  if (ref.operationId && op.operationId) return ref.operationId === op.operationId;
  if (ref.operation) return normalizeKey(ref.operation) === op.key;
  return false;
}

/**
 * Diff a collection against an OpenAPI spec: what's new, what's stale.
 *
 * `doc` is the parsed spec document, needed only to resolve a `$ref` inside a `requestBody` schema
 * while checking a body's contents. Optional so an existing caller keeps working; without it a
 * `$ref`-bearing body schema simply contributes no findings rather than a wrong one.
 */
export function computeDrift(
  ops: SpecOperation[],
  colOps: CollectionOp[],
  doc: Record<string, unknown> = {},
): DriftReport {
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
    for (const p of match.parameters) {
      if (p.in === "header" && p.required && !c.headerNames.includes(p.name.toLowerCase())) {
        const entry = `${match.key}: missing required header '${p.name}'`;
        changed.push(entry);
        note(entry, c);
      }
    }
    if (match.requestBodyRequired && !c.hasBody) {
      const entry = `${match.key}: missing required request body`;
      changed.push(entry);
      note(entry, c);
    }
    // The body's *contents* against the operation's schema. Checking only that a body exists misses
    // the most ordinary breaking change an API makes: a field that became required. Nothing else in
    // this tool catches it either — `contract` validates responses, and the mock's `--validate`
    // needs a server running.
    if (c.jsonBody !== undefined && match.requestBodySchema) {
      for (const v of validateAgainstSchema(c.jsonBody, match.requestBodySchema, doc)) {
        if (templated(c.jsonBody, v.path)) continue;
        // A "missing required property 'x'" violation is reported at `/x`, so prefixing the full
        // path would say the name twice ("body/species missing required property 'species'").
        const segments = v.path.split("/").filter(Boolean);
        const last = segments[segments.length - 1];
        const location = last !== undefined && v.message.includes(`'${last}'`) ? segments.slice(0, -1) : segments;
        const where = location.length === 0 ? "body" : `body/${location.join("/")}`;
        const entry = `${match.key}: ${where} ${v.message}`;
        changed.push(entry);
        note(entry, c);
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
    ...(sources.size > 0
      ? { sources: Object.fromEntries([...sources].map(([k, v]) => [k, [...v].sort()])) }
      : {}),
    ok: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}
