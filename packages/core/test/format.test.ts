import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildJsonSchemas, parse } from "../src/format";

const here = fileURLToPath(new URL(".", import.meta.url));
const petstore = join(here, "..", "..", "..", "examples", "petstore");

const sampleRequest = `
name: Get pet by id
method: GET
url: "{{baseUrl}}/pets/{{petId}}"
headers:
  Accept: application/json
assertions:
  - { type: status, equals: 200 }
  - { type: jsonpath, path: "$.id", exists: true }
docs: Fetch a single pet.
spec: { operation: "GET /pets/{id}" }
`.trim();

describe("format: request", () => {
  it("parses a valid request and applies defaults", () => {
    const r = parse.request.parse(sampleRequest);
    expect(r.name).toBe("Get pet by id");
    expect(r.method).toBe("GET");
    expect(r.tspec).toBe("0.1");
    expect(r.assertions).toHaveLength(2);
  });

  it("round-trips through serialize/parse without loss", () => {
    const r = parse.request.parse(sampleRequest);
    const out = parse.request.serialize(r);
    const r2 = parse.request.parse(out);
    expect(r2).toEqual(r);
  });

  it("round-trips capture, order, script, and graphql bodies", () => {
    const yaml = [
      "name: Login",
      "method: POST",
      'url: "{{base}}/login"',
      "order: 1",
      'body: { type: graphql, query: "{ me }", variables: { id: "1" } }',
      'capture: { token: "$.access_token", id: { jsonpath: "$.id" } }',
      'script: { post: "tr.expect(true)" }',
      "assertions: [ { type: status, equals: 200 } ]",
    ].join("\n");
    const r = parse.request.parse(yaml);
    const r2 = parse.request.parse(parse.request.serialize(r));
    expect(r2).toEqual(r);
    expect(r2.body).toEqual({ type: "graphql", query: "{ me }", variables: { id: "1" } });
    expect(r2.capture).toEqual({ token: "$.access_token", id: { jsonpath: "$.id" } });
  });

  it("rejects an invalid method", () => {
    const res = parse.request.safeParse("name: x\nmethod: FETCH\nurl: http://a");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/method/);
  });

  it("rejects unknown keys (catches agent typos)", () => {
    const res = parse.request.safeParse("name: x\nurl: http://a\nmethdo: GET");
    expect(res.ok).toBe(false);
  });

  it("rejects unknown keys in NESTED objects too (assertion/spec/auth/body typos surface)", () => {
    // A typo in an optional nested key used to be silently stripped, yielding confusing behavior
    // (a condition-less assertion that always fails, or an empty `spec: {}` link mis-reported as
    // stale drift). Every level is strict now.
    const assertionTypo = parse.request.safeParse(
      'name: x\nurl: http://a\nassertions:\n  - { type: jsonpath, path: "$.id", exits: true }',
    );
    expect(assertionTypo.ok).toBe(false); // `exits` should be `exists`

    const specTypo = parse.request.safeParse("name: x\nurl: http://a\nspec:\n  operatonId: getPet");
    expect(specTypo.ok).toBe(false); // `operatonId` should be `operationId`

    const authTypo = parse.request.safeParse(
      'name: x\nurl: http://a\nauth: { type: bearer, token: t, scheme: x }',
    );
    expect(authTypo.ok).toBe(false); // `scheme` is not a bearer-auth field

    // a correctly-spelled nested object still parses
    expect(
      parse.request.safeParse('name: x\nurl: http://a\nassertions:\n  - { type: jsonpath, path: "$.id", exists: true }').ok,
    ).toBe(true);
  });

  it("requires a url", () => {
    const res = parse.request.safeParse("name: x\nmethod: GET");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/url/);
  });
});

describe("format: example collection", () => {
  it("parses the petstore example files", () => {
    const folder = parse.folderConfig.parse(
      readFileSync(join(petstore, "folder.tspec.yaml"), "utf8"),
    );
    expect(folder.baseUrl).toBeDefined();

    const req = parse.request.parse(
      readFileSync(join(petstore, "get-pet.tspec.yaml"), "utf8"),
    );
    expect(req.method).toBe("GET");
    expect(req.spec?.operation).toBe("GET /pets/{id}");

    const env = parse.environment.parse(
      readFileSync(join(petstore, "environments", "local.env.yaml"), "utf8"),
    );
    expect(env.name).toBe("local");
    expect(env.secrets).toContain("token");
  });
});

describe("format: json schema", () => {
  it("builds published JSON Schemas from the Zod source", () => {
    const schemas = buildJsonSchemas();
    expect(Object.keys(schemas)).toEqual([
      "request.schema.json",
      "folder.schema.json",
      "environment.schema.json",
    ]);
    expect(JSON.stringify(schemas["request.schema.json"])).toMatch(/method/);
  });
});
