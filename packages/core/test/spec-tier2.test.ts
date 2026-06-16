import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { collectionOperations, computeDrift, parseOpenApi, probeLiveOperations } from "../src/spec";

const SPEC = `
openapi: 3.0.3
info: { title: T, version: "1.0.0" }
paths:
  /search:
    get:
      operationId: search
      parameters:
        - { name: q, in: query, required: true }
        - { name: page, in: query, required: false }
  /pets:
    get: { operationId: listPets }
`.trim();

describe("parseOpenApi parameters", () => {
  it("captures per-operation parameters", () => {
    const search = parseOpenApi(SPEC).operations.find((o) => o.key === "GET /search");
    expect(search?.parameters).toEqual([
      { name: "q", in: "query", required: true },
      { name: "page", in: "query", required: false },
    ]);
  });
});

describe("drift: changed (required params)", () => {
  const ops = parseOpenApi(SPEC).operations;

  it("flags a matched op missing a required query param", () => {
    const colOps = collectionOperations([
      { req: parse.request.parse("name: s\nurl: http://x/search\nspec: { operationId: search }") },
      { req: parse.request.parse("name: l\nurl: http://x/pets\nspec: { operationId: listPets }") },
    ]);
    const drift = computeDrift(ops, colOps);
    expect(drift.changed).toEqual(["GET /search: missing required query param 'q'"]);
    expect(drift.ok).toBe(false);
  });

  it("is clean when the required param is provided", () => {
    const colOps = collectionOperations([
      { req: parse.request.parse('name: s\nurl: "http://x/search?q={{term}}"\nspec: { operationId: search }') },
      { req: parse.request.parse("name: l\nurl: http://x/pets\nspec: { operationId: listPets }") },
    ]);
    expect(computeDrift(ops, colOps).changed).toEqual([]);
  });
});

describe("drift: live probing", () => {
  const ops = parseOpenApi(SPEC).operations;

  it("reports operations the live API returns 404 for", async () => {
    const fetchMock = (async (url: string | URL | Request) =>
      new Response("", { status: String(url).includes("/pets") ? 200 : 404 })) as typeof fetch;
    const result = await probeLiveOperations(ops, "http://api.test", { fetch: fetchMock });
    expect(result.missing).toEqual(["GET /search"]);
    expect(result.checked).toBe(2);
  });

  it("skips mutating methods for safety", async () => {
    const withPost = parseOpenApi(`${SPEC}\n    post: { operationId: createPet }`).operations;
    const fetchMock = (async () => new Response("", { status: 200 })) as typeof fetch;
    const result = await probeLiveOperations(withPost, "http://api.test", { fetch: fetchMock });
    expect(result.skipped).toContain("POST /pets");
    expect(result.missing).toEqual([]);
  });
});
