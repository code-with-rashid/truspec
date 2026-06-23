import { describe, expect, it } from "vitest";
import { computeDrift, refMatchesOp } from "../src/spec/drift";
import type { SpecOperation } from "../src/spec/openapi";
import type { CollectionOp } from "../src/spec/collection";

const op = (o: Partial<SpecOperation>): SpecOperation => ({ key: "GET /x", method: "GET", path: "/x", operationId: undefined, parameters: [], requestBodyRequired: false, ...o }) as SpecOperation;
const col = (o: Partial<CollectionOp> & { ref: CollectionOp["ref"] }): CollectionOp => ({ name: "r", queryParams: [], hasBody: false, ...o }) as CollectionOp;

describe("drift — exact matching & diffing (mutation kills)", () => {
  it("refMatchesOp: operationId match wins; mismatch is false", () => {
    expect(refMatchesOp({ operationId: "getPet" }, op({ operationId: "getPet" }))).toBe(true);
    expect(refMatchesOp({ operationId: "getPet" }, op({ operationId: "other" }))).toBe(false);
    // when ref has no operationId, fall through to operation-key matching
    expect(refMatchesOp({ operation: "GET /x" }, op({ key: "GET /x" }))).toBe(true);
    expect(refMatchesOp({ operation: "GET /y" }, op({ key: "GET /x" }))).toBe(false);
    // neither field → false
    expect(refMatchesOp({}, op({ key: "GET /x" }))).toBe(false);
  });

  it("normalizeKey (via refMatchesOp): trims, uppercases method, collapses inner whitespace", () => {
    expect(refMatchesOp({ operation: "  get   /a/b  " }, op({ key: "GET /a/b" }))).toBe(true); // trim + multi-space + upper
    expect(refMatchesOp({ operation: "get /a/b" }, op({ key: "GET /a/b" }))).toBe(true);
    // a single token (no path) is returned trimmed as-is, so it won't match a "METHOD path" key
    expect(refMatchesOp({ operation: "GET" }, op({ key: "GET" }))).toBe(true);
    expect(refMatchesOp({ operation: "GET" }, op({ key: "GET /a" }))).toBe(false);
    // a 2-token op normalizes (boundary parts.length === 2)
    expect(refMatchesOp({ operation: "post /a" }, op({ key: "POST /a" }))).toBe(true);
  });

  it("computeDrift: removed/added/changed are each detected and SORTED", () => {
    const ops = [op({ key: "GET /b" }), op({ key: "GET /a" })];
    const cols = [col({ ref: { operation: "GET /gone-2" }, name: "g2" }), col({ ref: { operation: "GET /gone-1" }, name: "g1" })];
    const r = computeDrift(ops, cols);
    expect(r.added).toEqual(["GET /a", "GET /b"]); // sorted (input was b,a)
    expect(r.removed).toEqual(["GET /gone-1", "GET /gone-2"]); // sorted
    expect(r.specOperations).toBe(2);
    expect(r.collectionOperations).toBe(2);
    expect(r.ok).toBe(false);
  });

  it("computeDrift: a referenced op is not 'added'; ok is true only when all three are empty", () => {
    const r = computeDrift([op({ key: "GET /a" })], [col({ ref: { operation: "GET /a" } })]);
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.changed).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("computeDrift: changed = required query missing OR required body missing; satisfied/optional don't drift", () => {
    const specOp = op({ key: "GET /a", parameters: [{ name: "q", in: "query", required: true }], requestBodyRequired: true });
    const missing = computeDrift([specOp], [col({ ref: { operation: "GET /a" }, queryParams: [], hasBody: false })]);
    expect(missing.changed.sort()).toEqual(["GET /a: missing required query param 'q'", "GET /a: missing required request body"].sort());
    const ok = computeDrift([specOp], [col({ ref: { operation: "GET /a" }, queryParams: ["q"], hasBody: true })]);
    expect(ok.changed).toEqual([]);
    // optional query missing → not changed
    const optional = computeDrift([op({ key: "GET /a", parameters: [{ name: "q", in: "query", required: false }] })], [col({ ref: { operation: "GET /a" } })]);
    expect(optional.changed).toEqual([]);
  });
});
