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

  // An unambiguous recursive oneOf: branch A requires a string `a`, branch B requires an integer `b`;
  // both `$ref` back to the node via `next`. Every level matches exactly one branch.
  const recursiveOneOf = {
    components: {
      schemas: {
        Node: {
          oneOf: [
            {
              type: "object",
              required: ["a"],
              properties: { a: { type: "string" }, next: { $ref: "#/components/schemas/Node" } },
              additionalProperties: false,
            },
            {
              type: "object",
              required: ["b"],
              properties: { b: { type: "integer" }, next: { $ref: "#/components/schemas/Node" } },
              additionalProperties: false,
            },
          ],
        },
      },
    },
  };
  const nodeRef = { $ref: "#/components/schemas/Node" };

  // Regression: `oneOf`/`anyOf` used to re-validate the same value subtree once per branch, so a
  // recursive ($ref-back) schema over a deep response was O(2^depth) — a ~25-deep value hung for
  // minutes (the whole vitest worker froze). Memoizing `conforms` by (value, schema) identity makes
  // it linear. Pre-fix this case never returns inside the per-test timeout; post-fix it is sub-ms.
  it("does not blow up exponentially on a recursive oneOf over a deep value", () => {
    let value: Record<string, unknown> = { a: "tip" };
    for (let i = 0; i < 30; i++) value = { a: String(i), next: value };
    const start = Date.now();
    const violations = validateAgainstSchema(value, nodeRef, recursiveOneOf);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(violations).toEqual([]); // every level matches exactly one branch
  });

  // Regression: a self-referential composition schema (`oneOf`/`anyOf` with a `$ref` back to itself)
  // re-validates the SAME value against itself with no value progress. For a PRIMITIVE value the
  // object cache can't help (primitives can't key a WeakMap), so this recursed 2^depth → MAX_DEPTH
  // and hung. Stack-based (value, schema) cycle detection breaks it. Must terminate fast.
  it("terminates on a primitive value against a self-referential oneOf", () => {
    const doc = {
      components: {
        schemas: {
          Node: {
            oneOf: [
              { oneOf: [{ enum: [true, 1, "x"] }, { $ref: "#/components/schemas/Node" }] },
              { $ref: "#/components/schemas/Node" },
            ],
          },
        },
      },
    };
    const start = Date.now();
    const violations = validateAgainstSchema("hello", { $ref: "#/components/schemas/Node" }, doc);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(Array.isArray(violations)).toBe(true); // returns deterministically, no hang/crash
  });

  // Regression: a self-referential value (value.next === value) against a recursive object schema
  // used to loop until MAX_DEPTH on every branch. Cycle detection must make it terminate.
  it("terminates on a self-referential (cyclic) object value", () => {
    const value: Record<string, unknown> = { id: 1 };
    value.next = value;
    const doc = {
      components: {
        schemas: {
          O: { type: "object", properties: { id: { type: "integer" }, next: { $ref: "#/components/schemas/O" } } },
        },
      },
    };
    const start = Date.now();
    const violations = validateAgainstSchema(value, { $ref: "#/components/schemas/O" }, doc);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(violations).toEqual([]);
  });

  // Regression (incomplete-fix follow-up): `allOf` recurses through the direct validate path, not
  // `conforms`, so memoizing only oneOf/anyOf left `allOf` with a self-`$ref` exponential. A deep
  // value against two allOf parts that both `$ref` back used to be O(2^depth); now linear.
  it("does not blow up exponentially on a recursive allOf over a deep value", () => {
    const doc = {
      components: {
        schemas: {
          Node: {
            allOf: [
              { type: "object", properties: { a: { type: "string" }, next: { $ref: "#/components/schemas/Node" } } },
              { type: "object", properties: { next: { $ref: "#/components/schemas/Node" } } },
            ],
          },
        },
      },
    };
    let value: Record<string, unknown> = { a: "tip" };
    for (let i = 0; i < 50; i++) value = { a: String(i), next: value };
    const start = Date.now();
    const violations = validateAgainstSchema(value, { $ref: "#/components/schemas/Node" }, doc);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(violations).toEqual([]);
  });

  // allOf merges its parts — the value must satisfy ALL of them, with correct violation paths.
  it("merges allOf parts and reports violations at the right path", () => {
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

  // Guard: memoization must not mask a real violation buried deep in a recursive oneOf structure.
  it("still reports a violation deep inside a recursive oneOf", () => {
    let value: Record<string, unknown> = { a: 999 }; // invalid leaf: matches neither branch
    for (let i = 0; i < 15; i++) value = { a: String(i), next: value };
    expect(validateAgainstSchema(value, nodeRef, recursiveOneOf)).toEqual([
      { path: "", message: "value matches 0 oneOf subschemas (expected exactly 1)" },
    ]);
  });

  // Guard: memoization (keyed on schema-node identity) must not corrupt oneOf's "exactly one" count
  // when two branches are structurally identical — a value matching both is still flagged.
  it("still flags a value matching two identical oneOf branches", () => {
    const schema = {
      oneOf: [
        { type: "object", properties: { x: { type: "string" } } },
        { type: "object", properties: { x: { type: "string" } } },
      ],
    };
    expect(validateAgainstSchema({ x: "hi" }, schema, {})).toEqual([
      { path: "", message: "value matches 2 oneOf subschemas (expected exactly 1)" },
    ]);
  });

  // Regression: an array `type` (OpenAPI 3.1 / JSON Schema, the idiomatic way to say "nullable")
  // used to be ignored — the validator silently accepted ANY value, a false negative that defeats
  // contract validation. The non-null value must now satisfy at least one listed type.
  describe("array type (OpenAPI 3.1 union types)", () => {
    it("accepts null and the matching type, rejects others for type:[string,null]", () => {
      const schema = { type: ["string", "null"] };
      expect(validateAgainstSchema("hi", schema, {})).toEqual([]);
      expect(validateAgainstSchema(null, schema, {})).toEqual([]);
      expect(validateAgainstSchema(123, schema, {})).toEqual([
        { path: "", message: "expected one of type [string, null], got number" },
      ]);
    });

    it("treats a non-nullable union as a plain union (type:[string,integer])", () => {
      const schema = { type: ["string", "integer"] };
      expect(validateAgainstSchema(5, schema, {})).toEqual([]);
      expect(validateAgainstSchema("x", schema, {})).toEqual([]);
      expect(validateAgainstSchema(true, schema, {})).toEqual([
        { path: "", message: "expected one of type [string, integer], got boolean" },
      ]);
    });

    it("still applies sibling keywords (properties) to the object arm of type:[object,null]", () => {
      const schema = { type: ["object", "null"], properties: { a: { type: "string" } } };
      expect(validateAgainstSchema({ a: "x" }, schema, {})).toEqual([]);
      expect(validateAgainstSchema(null, schema, {})).toEqual([]);
      expect(validateAgainstSchema({ a: 1 }, schema, {})).not.toEqual([]); // a must be string
    });
  });

  describe("composition keywords are conjunctive with sibling constraints", () => {
    // Regression: allOf/anyOf/oneOf used to short-circuit (`return`), silently dropping any sibling
    // `type`/`required`/`properties` checks — so a non-conforming response passed. JSON Schema is
    // conjunctive: every keyword present must hold.
    it("enforces sibling required alongside allOf", () => {
      const schema = {
        type: "object",
        required: ["id"],
        properties: { id: { type: "integer" } },
        allOf: [{ type: "object", properties: { name: { type: "string" } } }],
      };
      expect(validateAgainstSchema({ name: "x" }, schema, {})).toEqual([
        { path: "/id", message: "missing required property 'id'" },
      ]);
      expect(validateAgainstSchema({ id: 1, name: "x" }, schema, {})).toEqual([]);
    });

    it("enforces sibling required alongside allOf:[{$ref}] (the common OpenAPI shape)", () => {
      const doc = { components: { schemas: { Base: { type: "object", properties: { createdAt: { type: "string" } } } } } };
      const schema = {
        type: "object",
        required: ["id"],
        properties: { id: { type: "integer" } },
        allOf: [{ $ref: "#/components/schemas/Base" }],
      };
      expect(validateAgainstSchema({ createdAt: "2026-01-01" }, schema, doc)).toEqual([
        { path: "/id", message: "missing required property 'id'" },
      ]);
      // a fully-conforming value still passes (no false positive)
      expect(validateAgainstSchema({ id: 1, createdAt: "2026-01-01" }, schema, doc)).toEqual([]);
      // and the $ref'd Base constraint is still enforced
      expect(validateAgainstSchema({ id: 1, createdAt: 5 }, schema, doc)).toEqual([
        { path: "/createdAt", message: "expected string, got number" },
      ]);
    });

    it("enforces sibling properties alongside anyOf", () => {
      const schema = { properties: { a: { type: "string" } }, anyOf: [{ type: "object" }] };
      expect(validateAgainstSchema({ a: 123 }, schema, {})).toEqual([
        { path: "/a", message: "expected string, got number" },
      ]);
      expect(validateAgainstSchema({ a: "ok" }, schema, {})).toEqual([]);
    });

    it("enforces sibling type alongside oneOf", () => {
      const schema = {
        type: "object",
        oneOf: [{ properties: { a: { type: "string" } } }, { properties: { b: { type: "number" } } }],
      };
      const v = validateAgainstSchema("not an object", schema, {});
      expect(v.some((x) => x.message === "expected object, got string")).toBe(true);
    });
  });
});
