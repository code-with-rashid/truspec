import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import {
  collectionOperations,
  computeCoverage,
  computeDrift,
  coverageReport,
  driftReport,
  parseOpenApi,
} from "../src/spec";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const petstore = resolve(repoRoot, "examples", "petstore");
const specPath = resolve(petstore, "openapi.yaml");

const SPEC = `
openapi: 3.0.3
info: { title: Petstore, version: 1.0.0 }
paths:
  /pets:
    get: { operationId: listPets }
    post: { operationId: createPet }
  /pets/{id}:
    get: { operationId: getPetById }
`.trim();

describe("parseOpenApi", () => {
  it("extracts operations with canonical keys", () => {
    const summary = parseOpenApi(SPEC);
    expect(summary.title).toBe("Petstore");
    expect(summary.operations.map((o) => o.key)).toEqual([
      "GET /pets",
      "GET /pets/{id}",
      "POST /pets",
    ]);
    expect(summary.operations.find((o) => o.key === "GET /pets/{id}")?.operationId).toBe("getPetById");
  });
});

describe("computeDrift", () => {
  const ops = parseOpenApi(SPEC).operations;

  it("flags spec operations missing from the collection as added", () => {
    const colOps = collectionOperations([
      { req: parse.request.parse('name: get\nurl: http://x\nspec: { operationId: getPetById }') },
    ]);
    const drift = computeDrift(ops, colOps);
    expect(drift.added).toEqual(["GET /pets", "POST /pets"]);
    expect(drift.removed).toEqual([]);
    expect(drift.ok).toBe(false);
  });

  it("flags requests referencing unknown operations as removed", () => {
    const colOps = collectionOperations([
      { req: parse.request.parse('name: gone\nurl: http://x\nspec: { operation: "DELETE /pets/{id}" }') },
    ]);
    const drift = computeDrift(ops, colOps);
    expect(drift.removed).toContain("DELETE /pets/{id}");
    expect(drift.ok).toBe(false);
  });

  it("is clean when every operation is referenced", () => {
    const colOps = collectionOperations([
      { req: parse.request.parse('name: a\nurl: http://x\nspec: { operation: "GET /pets" }') },
      { req: parse.request.parse('name: b\nurl: http://x\nspec: { operation: "POST /pets" }') },
      { req: parse.request.parse('name: c\nurl: http://x\nspec: { operationId: getPetById }') },
    ]);
    expect(computeDrift(ops, colOps).ok).toBe(true);
  });
});

describe("computeCoverage", () => {
  const ops = parseOpenApi(SPEC).operations;

  it("counts only requests that have assertions", () => {
    const colOps = collectionOperations([
      {
        req: parse.request.parse(
          'name: tested\nurl: http://x\nspec: { operationId: getPetById }\nassertions:\n  - { type: status, equals: 200 }',
        ),
      },
      { req: parse.request.parse('name: untested\nurl: http://x\nspec: { operation: "GET /pets" }') },
    ]);
    const cov = computeCoverage(ops, colOps);
    expect(cov.covered).toEqual(["GET /pets/{id}"]);
    expect(cov.uncovered).toEqual(["GET /pets", "POST /pets"]);
    expect(cov.percent).toBe(33);
  });

  it("applies a minimum-percent gate", () => {
    expect(computeCoverage(ops, [], 0).ok).toBe(true);
    expect(computeCoverage(ops, [], 80).ok).toBe(false);
  });
});

describe("fs reports against the petstore example", () => {
  it("driftReport finds the two untracked endpoints", () => {
    const drift = driftReport(petstore, specPath);
    expect(drift.added).toEqual(["GET /pets", "POST /pets"]);
    expect(drift.removed).toEqual([]);
  });

  it("coverageReport reports 33% from the single tested request", () => {
    const cov = coverageReport(petstore, specPath);
    expect(cov.covered).toEqual(["GET /pets/{id}"]);
    expect(cov.percent).toBe(33);
  });
});
