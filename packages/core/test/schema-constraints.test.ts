import { describe, expect, it } from "vitest";
import { validateAgainstSchema } from "../src/spec/validate-response";

const check = (value: unknown, schema: Record<string, unknown>): string[] =>
  validateAgainstSchema(value, schema, {}).map((v) => `${v.path}: ${v.message}`);

const ok = (value: unknown, schema: Record<string, unknown>): void => {
  expect(check(value, schema)).toEqual([]);
};

/**
 * `type`, `required` and `enum` catch a response of the wrong *shape*. These catch one of the right
 * shape carrying wrong *values*, which the validator used to pass in silence — so a mock generated
 * from a spec returned `id: 0` against `minimum: 1` and one item against `minItems: 2`, and
 * `truspec contract` called it conforming.
 */
describe("numeric bounds", () => {
  it("enforces minimum and maximum", () => {
    ok(5, { type: "integer", minimum: 1, maximum: 10 });
    ok(1, { type: "integer", minimum: 1 });
    expect(check(0, { type: "integer", minimum: 1 })).toEqual([": 0 is less than minimum 1"]);
    expect(check(11, { type: "integer", maximum: 10 })).toEqual([": 11 is greater than maximum 10"]);
  });

  it("reads OpenAPI 3.0's boolean exclusiveMinimum/Maximum as a modifier on the bound", () => {
    ok(2, { type: "integer", minimum: 1, exclusiveMinimum: true });
    expect(check(1, { type: "integer", minimum: 1, exclusiveMinimum: true })).toEqual([
      ": 1 is not greater than minimum 1",
    ]);
    expect(check(10, { type: "integer", maximum: 10, exclusiveMaximum: true })).toEqual([
      ": 10 is not less than maximum 10",
    ]);
  });

  it("reads JSON Schema 2020-12's numeric exclusiveMinimum/Maximum as bounds of their own", () => {
    ok(2, { type: "integer", exclusiveMinimum: 1 });
    expect(check(1, { type: "integer", exclusiveMinimum: 1 })).toEqual([": 1 is not greater than exclusiveMinimum 1"]);
    expect(check(10, { type: "integer", exclusiveMaximum: 10 })).toEqual([": 10 is not less than exclusiveMaximum 10"]);
  });

  it("enforces multipleOf without tripping over binary floating point", () => {
    ok(0.3, { type: "number", multipleOf: 0.1 }); // 0.3 / 0.1 === 2.9999999999999996
    ok(9, { type: "integer", multipleOf: 3 });
    expect(check(10, { type: "integer", multipleOf: 3 })).toEqual([": 10 is not a multiple of 3"]);
  });

  it("ignores a zero or non-numeric multipleOf rather than dividing by it", () => {
    ok(5, { type: "number", multipleOf: 0 });
    ok(5, { type: "number", multipleOf: "3" });
  });
});

describe("string length and pattern", () => {
  it("enforces minLength and maxLength", () => {
    ok("abc", { type: "string", minLength: 3, maxLength: 5 });
    expect(check("ab", { type: "string", minLength: 3 })).toEqual([": string length 2 is less than minLength 3"]);
    expect(check("abcdef", { type: "string", maxLength: 5 })).toEqual([
      ": string length 6 is greater than maxLength 5",
    ]);
  });

  it("counts code points, not UTF-16 units, so an emoji is one character", () => {
    // "👍" is two UTF-16 units; JSON Schema counts characters.
    ok("👍", { type: "string", maxLength: 1 });
    expect(check("👍👍", { type: "string", maxLength: 1 })).toEqual([": string length 2 is greater than maxLength 1"]);
  });

  it("enforces pattern", () => {
    ok("ab-12", { type: "string", pattern: "^[a-z]{2}-\\d{2}$" });
    expect(check("nope", { type: "string", pattern: "^[a-z]{2}-\\d{2}$" })[0]).toContain("does not match pattern");
  });

  it("blames the schema, not the response, for a pattern it cannot compile", () => {
    const violations = check("anything", { type: "string", pattern: "([" });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("is not a valid regular expression");
  });
});

describe("array count and uniqueness", () => {
  it("enforces minItems and maxItems", () => {
    ok([1, 2], { type: "array", minItems: 2, maxItems: 3 });
    expect(check([1], { type: "array", minItems: 2 })).toEqual([": array has 1 item(s), fewer than minItems 2"]);
    expect(check([1, 2, 3], { type: "array", maxItems: 2 })).toEqual([": array has 3 item(s), more than maxItems 2"]);
  });

  it("enforces uniqueItems structurally, not by reference", () => {
    ok([{ a: 1 }, { a: 2 }], { type: "array", uniqueItems: true });
    expect(check([{ a: 1 }, { a: 1 }], { type: "array", uniqueItems: true })[0]).toContain("duplicate item");
  });

  it("reports a duplicate once, not once per repeat", () => {
    expect(check([1, 1, 1, 1], { type: "array", uniqueItems: true })).toHaveLength(1);
  });
});

describe("object property counts", () => {
  it("enforces minProperties and maxProperties", () => {
    ok({ a: 1, b: 2 }, { type: "object", minProperties: 2, maxProperties: 3 });
    expect(check({ a: 1 }, { type: "object", minProperties: 2 })[0]).toContain("fewer than minProperties 2");
    expect(check({ a: 1, b: 2 }, { type: "object", maxProperties: 1 })[0]).toContain("more than maxProperties 1");
  });
});

describe("how constraints combine with the rest of the validator", () => {
  it("applies at every depth, with the offending path", () => {
    const schema = {
      type: "object",
      properties: { items: { type: "array", items: { type: "object", properties: { id: { type: "integer", minimum: 1 } } } } },
    };
    expect(check({ items: [{ id: 3 }, { id: 0 }] }, schema)).toEqual(["/items/1/id: 0 is less than minimum 1"]);
  });

  it("is independent of `type`, since every JSON Schema keyword is its own constraint", () => {
    // No `type` declared; the bound still applies to a number.
    expect(check(0, { minimum: 1 })).toEqual([": 0 is less than minimum 1"]);
  });

  it("does not apply a keyword meant for another type", () => {
    // `minLength` says nothing about a number, and `minimum` nothing about a string.
    ok(0, { minLength: 5 });
    ok("ab", { minimum: 100 });
    ok(null, { type: ["string", "null"], minLength: 5 });
  });

  it("lets a constraint discriminate a oneOf branch", () => {
    const schema = {
      oneOf: [
        { type: "string", pattern: "^[0-9]+$" },
        { type: "string", pattern: "^[a-z]+$" },
      ],
    };
    ok("123", schema);
    ok("abc", schema);
    // Matches neither branch, so it matches 0 of the oneOf.
    expect(check("a1", schema)[0]).toContain("matches 0 oneOf subschemas");
  });

  it("reports every violation on one value, not just the first", () => {
    expect(check("ab", { type: "string", minLength: 5, pattern: "^\\d+$" })).toHaveLength(2);
  });
});
