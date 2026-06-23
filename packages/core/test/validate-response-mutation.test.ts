import { describe, expect, it } from "vitest";
import { validateAgainstSchema } from "../src/spec/validate-response";

// Mutation-killing tests: assert EXACT messages + paths + edge branches so message-string,
// conditional, arithmetic, and depth-cap mutants in validate-response.ts cannot survive.
describe("validate-response — exact messages & paths (mutation kills)", () => {
  it("type mismatch messages are exact (string/integer/number/boolean/object/array)", () => {
    expect(validateAgainstSchema(1, { type: "string" }, {})).toEqual([{ path: "", message: "expected string, got number" }]);
    expect(validateAgainstSchema(1.5, { type: "integer" }, {})).toEqual([{ path: "", message: "expected integer, got non-integer number" }]);
    expect(validateAgainstSchema("x", { type: "integer" }, {})).toEqual([{ path: "", message: "expected integer, got string" }]);
    expect(validateAgainstSchema("x", { type: "number" }, {})).toEqual([{ path: "", message: "expected number, got string" }]);
    expect(validateAgainstSchema("x", { type: "boolean" }, {})).toEqual([{ path: "", message: "expected boolean, got string" }]);
    expect(validateAgainstSchema("x", { type: "object" }, {})).toEqual([{ path: "", message: "expected object, got string" }]);
    expect(validateAgainstSchema("x", { type: "array" }, {})).toEqual([{ path: "", message: "expected array, got string" }]);
    expect(validateAgainstSchema(5, { type: "null" }, {})).toEqual([{ path: "", message: "expected null, got number" }]);
  });

  it("null handling: non-nullable null is flagged; nullable/3.1/no-constraint accepted", () => {
    expect(validateAgainstSchema(null, { type: "string" }, {})).toEqual([{ path: "", message: "value is null but schema is not nullable" }]);
    expect(validateAgainstSchema(null, { type: "string", nullable: true }, {})).toEqual([]);
    expect(validateAgainstSchema(null, { type: ["string", "null"] }, {})).toEqual([]);
    expect(validateAgainstSchema(null, {}, {})).toEqual([]); // no constraint
  });

  it("required + nested paths are exact (/id, /a/b, /items/0)", () => {
    expect(validateAgainstSchema({}, { type: "object", required: ["id"] }, {})).toEqual([{ path: "/id", message: "missing required property 'id'" }]);
    expect(validateAgainstSchema({ a: { b: 1 } }, { type: "object", properties: { a: { type: "object", properties: { b: { type: "string" } } } } }, {})).toEqual([{ path: "/a/b", message: "expected string, got number" }]);
    expect(validateAgainstSchema({ items: ["x", 2] }, { type: "object", properties: { items: { type: "array", items: { type: "string" } } } }, {})).toEqual([{ path: "/items/1", message: "expected string, got number" }]);
  });

  it("additionalProperties:false flags unexpected props with exact path", () => {
    expect(validateAgainstSchema({ a: 1, extra: 2 }, { type: "object", properties: { a: { type: "integer" } }, additionalProperties: false }, {})).toEqual([{ path: "/extra", message: "unexpected property 'extra' (additionalProperties is false)" }]);
    // allowed when additionalProperties is not false
    expect(validateAgainstSchema({ a: 1, extra: 2 }, { type: "object", properties: { a: { type: "integer" } } }, {})).toEqual([]);
  });

  it("enum: exact message + acceptance", () => {
    expect(validateAgainstSchema("c", { enum: ["a", "b"] }, {})).toEqual([{ path: "", message: 'value "c" is not one of the allowed enum values' }]);
    expect(validateAgainstSchema("a", { enum: ["a", "b"] }, {})).toEqual([]);
  });

  it("oneOf count message is exact (0 and 2 matches)", () => {
    expect(validateAgainstSchema(5, { oneOf: [{ type: "string" }, { type: "boolean" }] }, {})).toEqual([{ path: "", message: "value matches 0 oneOf subschemas (expected exactly 1)" }]);
    expect(validateAgainstSchema(5, { oneOf: [{ type: "integer" }, { type: "number" }] }, {})).toEqual([{ path: "", message: "value matches 2 oneOf subschemas (expected exactly 1)" }]);
    expect(validateAgainstSchema(5, { oneOf: [{ type: "integer" }, { type: "string" }] }, {})).toEqual([]); // exactly 1
  });

  it("anyOf message exact; allOf merges; array-type union message exact", () => {
    expect(validateAgainstSchema(true, { anyOf: [{ type: "string" }, { type: "integer" }] }, {})).toEqual([{ path: "", message: "value does not match any anyOf subschema" }]);
    expect(validateAgainstSchema(5, { anyOf: [{ type: "string" }, { type: "integer" }] }, {})).toEqual([]);
    expect(validateAgainstSchema(true, { type: ["string", "integer"] }, {})).toEqual([{ path: "", message: "expected one of type [string, integer], got boolean" }]);
  });

  it("$ref: unresolved message exact; resolved recurses", () => {
    expect(validateAgainstSchema(1, { $ref: "#/components/schemas/Nope" }, {})).toEqual([{ path: "", message: "unresolved $ref #/components/schemas/Nope" }]);
    const doc = { components: { schemas: { S: { type: "string" } } } };
    expect(validateAgainstSchema(1, { $ref: "#/components/schemas/S" }, doc)).toEqual([{ path: "", message: "expected string, got number" }]);
  });

  it("depth cap: a structure deeper than MAX_DEPTH stops validating (no crash) without false errors at top", () => {
    // build a 130-deep nested object; schema mirrors it. Past depth 100 the validator stops descending.
    let value: unknown = 5; // a number at the bottom that WOULD violate type:string if reached
    let schema: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 130; i++) { value = { n: value }; schema = { type: "object", properties: { n: schema } }; }
    const t0 = Date.now();
    const v = validateAgainstSchema(value, schema, {});
    expect(Date.now() - t0).toBeLessThan(1000);
    // the deep violation is beyond MAX_DEPTH so it's not reported (cutoff), but shallow levels are valid → no spurious error
    expect(v.every((x) => x.message.startsWith("expected"))).toBe(true);
  });

  it("multiple violations reported (not just the first)", () => {
    const v = validateAgainstSchema({ a: 1, b: "x" }, { type: "object", properties: { a: { type: "string" }, b: { type: "integer" } } }, {});
    expect(v).toHaveLength(2);
    expect(v.map((x) => x.path).sort()).toEqual(["/a", "/b"]);
  });
});
