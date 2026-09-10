import { describe, expect, it } from "vitest";
import { generateExample } from "../src/mock/engine";
import { validateAgainstSchema } from "../src/spec/validate-response";

const gen = (schema: Record<string, unknown>): unknown => generateExample(schema, {});

describe("the mock generator respects the schema's bounds", () => {
  it("starts a number at its minimum instead of a flat 0", () => {
    expect(gen({ type: "integer", minimum: 1 })).toBe(1);
    expect(gen({ type: "integer", minimum: 42 })).toBe(42);
    expect(gen({ type: "number", minimum: 0.5 })).toBe(0.5);
  });

  it("stays inside an exclusive bound, in either spelling", () => {
    expect(gen({ type: "integer", minimum: 1, exclusiveMinimum: true })).toBe(2);
    expect(gen({ type: "integer", exclusiveMinimum: 1 })).toBe(2);
  });

  it("comes down to a maximum when the default would exceed it", () => {
    expect(gen({ type: "integer", minimum: 5, maximum: 3 })).toBe(3);
    expect(gen({ type: "integer", maximum: -1 })).toBe(-1);
  });

  it("rounds up to a multipleOf so the minimum is never undercut by the rounding", () => {
    expect(gen({ type: "integer", minimum: 4, multipleOf: 3 })).toBe(6);
    expect(gen({ type: "integer", multipleOf: 5 })).toBe(0);
  });

  it("emits minItems elements rather than always one", () => {
    expect(gen({ type: "array", items: { type: "integer" }, minItems: 3 })).toHaveLength(3);
    expect(gen({ type: "array", items: { type: "integer" } })).toHaveLength(1);
  });

  it("never exceeds maxItems, even when minItems is absent", () => {
    expect(gen({ type: "array", items: { type: "integer" }, maxItems: 0 })).toHaveLength(0);
  });

  it("pads and trims a plain string to its length bounds", () => {
    expect(gen({ type: "string", minLength: 10 })).toHaveLength(10);
    expect(gen({ type: "string", maxLength: 3 })).toBe("str");
  });

  it("leaves a formatted string alone, since padding would stop it being that format", () => {
    // "2026-01-01" padded to minLength 40 is no longer a date.
    expect(gen({ type: "string", format: "date", minLength: 40 })).toBe("2026-01-01");
  });

  it("still prefers what the spec actually says over any generated value", () => {
    expect(gen({ type: "integer", minimum: 1, example: 99 })).toBe(99);
    expect(gen({ type: "integer", minimum: 1, default: 7 })).toBe(7);
    expect(gen({ type: "string", enum: ["b", "a"], minLength: 40 })).toBe("b");
  });
});

/**
 * The property that would have caught all of this at once: a mock is a stand-in for the API, so
 * what it serves must satisfy the very document it was generated from. It did not — the generator
 * ignored the bounds and the validator did not check them, so the two agreed on a response the
 * spec forbids.
 */
describe("a generated example conforms to the schema that produced it", () => {
  const demanding: Record<string, unknown> = {
    type: "object",
    required: ["id", "name", "status", "createdAt", "tags", "meta", "ratio"],
    minProperties: 3,
    properties: {
      id: { type: "integer", minimum: 1, maximum: 1000 },
      name: { type: "string", minLength: 3, maxLength: 40 },
      status: { type: "string", enum: ["active", "archived"] },
      createdAt: { type: "string", format: "date-time" },
      ratio: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.25 },
      count: { type: "integer", exclusiveMinimum: 0 },
      tags: { type: "array", items: { type: "string", minLength: 2 }, minItems: 2, maxItems: 5 },
      meta: {
        type: "object",
        required: ["owner"],
        properties: { owner: { type: "string", minLength: 1 }, level: { type: "integer", minimum: 1, multipleOf: 2 } },
      },
    },
  };

  it("holds for a schema using every constraint the validator now checks", () => {
    const example = generateExample(demanding, {});
    expect(validateAgainstSchema(example, demanding, {})).toEqual([]);
  });

  it("holds for an array of them, under minItems", () => {
    const listSchema = { type: "array", items: demanding, minItems: 2 };
    const example = generateExample(listSchema, {});
    expect(example).toHaveLength(2);
    expect(validateAgainstSchema(example, listSchema, {})).toEqual([]);
  });
});
