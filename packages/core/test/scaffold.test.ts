import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { scaffoldFromSpec } from "../src/spec/scaffold";

describe("scaffoldFromSpec", () => {
  it("emits one stub per operation, each linked to its spec key", () => {
    const spec = `openapi: 3.0.3
info: { title: T, version: "1" }
paths:
  /pets:
    get: { operationId: listPets, responses: { "200": { description: ok } } }
`;
    const r = scaffoldFromSpec(spec);
    expect(r.files).toHaveLength(1);
    const req = parse.request.parse(r.files[0]?.content ?? "");
    expect(req.spec?.operation).toBe("GET /pets");
  });

  it("does not crash on an operation with an empty-string operationId (falls back to the key)", () => {
    const spec = `openapi: 3.0.3
info: { title: T, version: "1" }
paths:
  /x: { get: { operationId: "", responses: { "200": { description: ok } } } }
`;
    const r = scaffoldFromSpec(spec); // pre-fix: threw on name.min(1)
    expect(r.files).toHaveLength(1);
    const req = parse.request.parse(r.files[0]?.content ?? "");
    expect(req.name).toBe("GET /x"); // falls back to the operation key, not ""
    expect(req.spec?.operationId).toBeUndefined(); // empty operationId omitted, not written as ""
  });

  it("gives colliding slugs unique filenames so no operation is silently overwritten", () => {
    // Distinct operations that slug to the same base: case-variant operationIds, and paths that
    // differ only in separators (`/a-b` vs `/a/b`). Each must get its own file.
    const spec = `openapi: 3.0.3
info: { title: T, version: "1" }
paths:
  /x: { get: { operationId: getUser, responses: { "200": { description: ok } } } }
  /y: { get: { operationId: GetUser, responses: { "200": { description: ok } } } }
  /a-b: { post: { responses: { "200": { description: ok } } } }
  /a/b: { post: { responses: { "200": { description: ok } } } }
`;
    const r = scaffoldFromSpec(spec);
    expect(r.files).toHaveLength(4); // one per operation
    const paths = r.files.map((f) => f.path);
    expect(new Set(paths).size).toBe(4); // all filenames distinct — no overwrite on disk
    expect(paths).toContain("getuser.tspec.yaml");
    expect(paths).toContain("getuser-2.tspec.yaml");
    // every emitted stub still parses and links back to a distinct operation
    const ops = r.files.map((f) => parse.request.parse(f.content).spec?.operation);
    expect(new Set(ops).size).toBe(4);
  });
});
