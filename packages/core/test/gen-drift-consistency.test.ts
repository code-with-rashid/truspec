import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { driftReport, scaffoldFromSpec, writeScaffold } from "../src/spec";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Scaffold a spec into a temp dir and drift the result back against that same spec. */
function scaffoldThenDrift(specPath: string) {
  const out = mkdtempSync(join(tmpdir(), "tspec-gen-"));
  dirs.push(out);
  writeScaffold(scaffoldFromSpec(readFileSync(specPath, "utf8")).files, out);
  return driftReport(out, specPath);
}

describe("what `gen` produces satisfies `drift` against the spec it came from", () => {
  // The invariant the two commands owe each other. `gen` is the on-ramp for spec-first users —
  // scaffold from OpenAPI, then gate CI on drift — and doing exactly that used to fail
  // immediately, with the user having done nothing wrong.
  for (const example of ["petstore", "blog"]) {
    it(`holds for the ${example} example`, () => {
      const report = scaffoldThenDrift(join(ROOT, "examples", example, "openapi.yaml"));
      expect(report.changed, `changed: ${report.changed.join(", ")}`).toEqual([]);
      expect(report.added, `untracked: ${report.added.join(", ")}`).toEqual([]);
      expect(report.removed, `stale: ${report.removed.join(", ")}`).toEqual([]);
      expect(report.ok).toBe(true);
    });
  }

  it("holds for an operation with a required query parameter and a required body", () => {
    // The two cases that were missing. `drift` reported them precisely — "missing required query
    // param 'limit'", "missing required request body" — while `gen` emitted neither.
    const dir = mkdtempSync(join(tmpdir(), "tspec-spec-"));
    dirs.push(dir);
    const specPath = join(dir, "openapi.yaml");
    const spec = [
      "openapi: 3.0.3",
      'info: { title: Shop, version: "1" }',
      "paths:",
      "  /products:",
      "    get:",
      "      operationId: listProducts",
      "      parameters:",
      "        - { name: limit, in: query, required: true, schema: { type: integer } }",
      "        - { name: cursor, in: query, required: false, schema: { type: string } }",
      '      responses: { "200": { description: ok } }',
      "    post:",
      "      operationId: createProduct",
      "      requestBody:",
      "        required: true",
      "        content:",
      "          application/json:",
      "            schema:",
      "              type: object",
      "              required: [name, priceCents]",
      "              properties:",
      "                name: { type: string }",
      "                priceCents: { type: integer }",
      '      responses: { "201": { description: created } }',
      "",
    ].join("\n");
    rmSync(specPath, { force: true });
    writeScaffold([{ path: "openapi.yaml", content: spec }], dir);

    const report = scaffoldThenDrift(specPath);
    expect(report.changed).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("emits the required query parameter but not the optional one", () => {
    // Scaffolding every optional parameter would bury the request in noise; the required ones are
    // the only ones the spec says it cannot work without.
    const dir = mkdtempSync(join(tmpdir(), "tspec-spec-"));
    dirs.push(dir);
    const spec = [
      "openapi: 3.0.3",
      'info: { title: S, version: "1" }',
      "paths:",
      "  /things:",
      "    get:",
      "      operationId: listThings",
      "      parameters:",
      "        - { name: limit, in: query, required: true, schema: { type: integer } }",
      "        - { name: cursor, in: query, required: false, schema: { type: string } }",
      '      responses: { "200": { description: ok } }',
      "",
    ].join("\n");
    const file = scaffoldFromSpec(spec).files[0];
    expect(file?.content).toContain("limit:");
    expect(file?.content).not.toContain("cursor:");
  });

  it("leaves a request with no required body alone", () => {
    const spec = [
      "openapi: 3.0.3",
      'info: { title: S, version: "1" }',
      "paths:",
      "  /things:",
      "    post:",
      "      operationId: makeThing",
      "      requestBody:",
      "        required: false",
      "        content: { application/json: { schema: { type: object } } }",
      '      responses: { "201": { description: ok } }',
      "",
    ].join("\n");
    expect(scaffoldFromSpec(spec).files[0]?.content).not.toContain("body:");
  });
});
