import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { parseOpenApi, responseSchemaFor, validateAgainstSchema } from "../src/spec";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const petstoreText = readFileSync(resolve(repoRoot, "examples", "petstore", "openapi.yaml"), "utf8");

describe("parseOpenApi response extraction", () => {
  const ops = parseOpenApi(petstoreText).operations;

  it("extracts response schemas keyed by status and media type", () => {
    const get = ops.find((o) => o.key === "GET /pets/{id}");
    expect(get?.responses).toEqual([
      { status: "200", contentType: "application/json", schema: { $ref: "#/components/schemas/Pet" } },
    ]);
  });

  it("keeps array response schemas verbatim", () => {
    const list = ops.find((o) => o.key === "GET /pets");
    expect(list?.responses[0]).toMatchObject({
      status: "200",
      contentType: "application/json",
      schema: { type: "array", items: { $ref: "#/components/schemas/Pet" } },
    });
  });

  it("collects every status and resolves $ref response objects", () => {
    const ops2 = parseOpenApi(
      `
openapi: 3.0.3
info: { title: T, version: "1" }
components:
  responses:
    NotFound:
      description: missing
      content:
        application/json:
          schema: { type: object, properties: { error: { type: string } } }
paths:
  /widgets/{id}:
    get:
      responses:
        "200":
          content:
            application/json: { schema: { type: object } }
        "404": { $ref: "#/components/responses/NotFound" }
        "500": { description: no schema here }
`.trim(),
    ).operations;
    const statuses = ops2[0]?.responses.map((r) => r.status);
    expect(statuses).toEqual(["200", "404"]); // 500 has no schema → omitted
    expect(responseSchemaFor(ops2[0]!, 404)).toEqual({
      type: "object",
      properties: { error: { type: "string" } },
    });
  });
});

describe("responseSchemaFor", () => {
  const op = parseOpenApi(
    `
openapi: 3.0.3
info: { title: T, version: "1" }
paths:
  /x:
    get:
      responses:
        "200": { content: { application/json: { schema: { type: object } } } }
        default: { content: { application/json: { schema: { type: object, properties: { error: { type: string } } } } } }
`.trim(),
  ).operations[0]!;

  it("returns the exact status schema", () => {
    expect(responseSchemaFor(op, 200)).toEqual({ type: "object" });
  });
  it("falls back to the default response", () => {
    expect(responseSchemaFor(op, 503)).toEqual({ type: "object", properties: { error: { type: "string" } } });
  });
  it("returns undefined when nothing matches and there is no default", () => {
    const noDefault = parseOpenApi(
      `
openapi: 3.0.3
info: { title: T, version: "1" }
paths:
  /x: { get: { responses: { "200": { content: { application/json: { schema: { type: object } } } } } } }
`.trim(),
    ).operations[0]!;
    expect(responseSchemaFor(noDefault, 404)).toBeUndefined();
    expect(responseSchemaFor(noDefault, 200, "text/plain")).toBeUndefined();
  });
});

describe("validateAgainstSchema", () => {
  const doc = {
    components: {
      schemas: {
        Pet: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            tag: { type: "string", nullable: true },
          },
        },
      },
    },
  };

  it("passes a conforming object", () => {
    expect(validateAgainstSchema({ id: 1, name: "Rex", tag: null }, { $ref: "#/components/schemas/Pet" }, doc)).toEqual(
      [],
    );
  });

  it("allows extra properties by default", () => {
    expect(validateAgainstSchema({ id: 1, name: "Rex", extra: true }, { $ref: "#/components/schemas/Pet" }, doc)).toEqual(
      [],
    );
  });

  it("flags a missing required property with its path", () => {
    const v = validateAgainstSchema({ id: 1 }, { $ref: "#/components/schemas/Pet" }, doc);
    expect(v).toEqual([{ path: "/name", message: "missing required property 'name'" }]);
  });

  it("flags a wrong primitive type", () => {
    const v = validateAgainstSchema({ id: "1", name: "Rex" }, { $ref: "#/components/schemas/Pet" }, doc);
    expect(v).toEqual([{ path: "/id", message: "expected integer, got string" }]);
  });

  it("rejects a non-integer number for an integer field", () => {
    const v = validateAgainstSchema({ id: 1.5, name: "Rex" }, { $ref: "#/components/schemas/Pet" }, doc);
    expect(v).toEqual([{ path: "/id", message: "expected integer, got non-integer number" }]);
  });

  it("honors nullable and rejects null on a non-nullable field", () => {
    expect(validateAgainstSchema({ id: 1, name: "Rex", tag: null }, { $ref: "#/components/schemas/Pet" }, doc)).toEqual(
      [],
    );
    const v = validateAgainstSchema({ id: null, name: "Rex" }, { $ref: "#/components/schemas/Pet" }, doc);
    expect(v).toEqual([{ path: "/id", message: "value is null but schema is not nullable" }]);
  });

  it("validates array items by path index", () => {
    const schema = { type: "array", items: { type: "integer" } };
    const v = validateAgainstSchema([1, 2, "three"], schema, {});
    expect(v).toEqual([{ path: "/2", message: "expected integer, got string" }]);
  });

  it("checks enum membership", () => {
    const schema = { type: "string", enum: ["open", "closed"] };
    expect(validateAgainstSchema("open", schema, {})).toEqual([]);
    expect(validateAgainstSchema("pending", schema, {})).toEqual([
      { path: "", message: 'value "pending" is not one of the allowed enum values' },
    ]);
  });

  it("merges allOf constraints", () => {
    const schema = {
      allOf: [
        { type: "object", required: ["a"], properties: { a: { type: "string" } } },
        { type: "object", required: ["b"], properties: { b: { type: "integer" } } },
      ],
    };
    expect(validateAgainstSchema({ a: "x", b: 1 }, schema, {})).toEqual([]);
    expect(validateAgainstSchema({ a: "x" }, schema, {})).toEqual([
      { path: "/b", message: "missing required property 'b'" },
    ]);
  });

  it("accepts a value matching exactly one oneOf branch", () => {
    const schema = { oneOf: [{ type: "string" }, { type: "integer" }] };
    expect(validateAgainstSchema("x", schema, {})).toEqual([]);
    expect(validateAgainstSchema(true, schema, {})).toEqual([
      { path: "", message: "value matches 0 oneOf subschemas (expected exactly 1)" },
    ]);
  });

  it("accepts a value matching at least one anyOf branch", () => {
    const schema = { anyOf: [{ type: "string" }, { type: "integer" }] };
    expect(validateAgainstSchema(7, schema, {})).toEqual([]);
    expect(validateAgainstSchema(true, schema, {})).toEqual([
      { path: "", message: "value does not match any anyOf subschema" },
    ]);
  });

  it("enforces additionalProperties:false", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    };
    expect(validateAgainstSchema({ a: "x", b: 1 }, schema, {})).toEqual([
      { path: "/b", message: "unexpected property 'b' (additionalProperties is false)" },
    ]);
  });

  it("validates the petstore Pet schema end to end", () => {
    const { components } = parseYaml(petstoreText) as { components: Record<string, unknown> };
    const doc2 = { components };
    expect(validateAgainstSchema({ id: 1, name: "Rex", tag: "good" }, { $ref: "#/components/schemas/Pet" }, doc2)).toEqual(
      [],
    );
    expect(validateAgainstSchema({ id: "1" }, { $ref: "#/components/schemas/Pet" }, doc2)).toEqual([
      { path: "/id", message: "expected integer, got string" },
    ]);
  });
});
