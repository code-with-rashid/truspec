import { describe, expect, it } from "vitest";
import { createMockResponder, generateExample } from "../src/mock/engine";

describe("generateExample — branch coverage", () => {
  const doc = { components: { schemas: { Pet: { type: "object", properties: { id: { type: "integer" } } } } } } as Record<string, unknown>;

  it("string formats: date-time / date / uuid / email / uri / plain", () => {
    expect(generateExample({ type: "string", format: "date-time" }, doc)).toBe("2026-01-01T00:00:00Z");
    expect(generateExample({ type: "string", format: "date" }, doc)).toBe("2026-01-01");
    expect(generateExample({ type: "string", format: "uuid" }, doc)).toBe("00000000-0000-0000-0000-000000000000");
    expect(generateExample({ type: "string", format: "email" }, doc)).toBe("user@example.com");
    expect(generateExample({ type: "string", format: "uri" }, doc)).toBe("https://example.com");
    expect(generateExample({ type: "string" }, doc)).toBe("string");
  });

  it("primitives: integer / number / boolean / null fallback", () => {
    expect(generateExample({ type: "integer" }, doc)).toBe(0);
    expect(generateExample({ type: "number" }, doc)).toBe(0);
    expect(generateExample({ type: "boolean" }, doc)).toBe(true);
    expect(generateExample({}, doc)).toBeNull();
  });

  it("example / default / enum take precedence", () => {
    expect(generateExample({ type: "string", example: "EX" }, doc)).toBe("EX");
    expect(generateExample({ type: "string", default: "DEF" }, doc)).toBe("DEF");
    expect(generateExample({ enum: ["a", "b"] }, doc)).toBe("a");
  });

  it("$ref resolved and unresolved", () => {
    expect(generateExample({ $ref: "#/components/schemas/Pet" }, doc)).toEqual({ id: 0 });
    expect(generateExample({ $ref: "#/components/schemas/Nope" }, doc)).toBeNull();
  });

  it("object (explicit + implied by properties), array, allOf merge, oneOf/anyOf first", () => {
    expect(generateExample({ type: "object", properties: { a: { type: "string" }, b: { type: "integer" } } }, doc)).toEqual({ a: "string", b: 0 });
    expect(generateExample({ properties: { a: { type: "boolean" } } }, doc)).toEqual({ a: true }); // implied object
    expect(generateExample({ type: "array", items: { type: "integer" } }, doc)).toEqual([0]);
    expect(generateExample({ allOf: [{ properties: { a: { type: "string" } } }, { properties: { b: { type: "integer" } } }] }, doc)).toEqual({ a: "string", b: 0 });
    expect(generateExample({ oneOf: [{ type: "string" }, { type: "integer" }] }, doc)).toBe("string");
    expect(generateExample({ anyOf: [{ type: "boolean" }] }, doc)).toBe(true);
  });

  it("recursive $ref is depth-capped (returns null past depth 6, terminates)", () => {
    const rdoc = { components: { schemas: { Node: { type: "object", properties: { next: { $ref: "#/components/schemas/Node" } } } } } } as Record<string, unknown>;
    const ex = generateExample({ $ref: "#/components/schemas/Node" }, rdoc) as { next?: unknown };
    expect(ex).toBeTypeOf("object");
    // chain terminates (no infinite recursion) — walk to the bottom
    let n: { next?: unknown } | null = ex, depth = 0;
    while (n && typeof n === "object" && "next" in n && n.next) { n = n.next as typeof n; if (++depth > 20) break; }
    expect(depth).toBeLessThan(20);
  });
});

describe("pickResponse / createMockResponder — branch coverage", () => {
  const respond = (spec: string, m = "GET", p = "/x") => createMockResponder(spec).respond(m, p);

  it("inline example wins over schema", () => {
    const r = respond('openapi: 3.0.3\ninfo: { title: T, version: "1" }\npaths:\n  /x: { get: { responses: { "200": { content: { application/json: { example: { hi: 1 }, schema: { type: object } } } } } } }');
    expect(JSON.parse(r!.body)).toEqual({ hi: 1 });
  });
  it("examples-map first value used", () => {
    const r = respond('openapi: 3.0.3\ninfo: { title: T, version: "1" }\npaths:\n  /x: { get: { responses: { "200": { content: { application/json: { examples: { a: { value: { hi: 2 } } } } } } } } }');
    expect(JSON.parse(r!.body)).toEqual({ hi: 2 });
  });
  it("default response and codes[0] fallback", () => {
    const dflt = respond('openapi: 3.0.3\ninfo: { title: T, version: "1" }\npaths:\n  /x: { get: { responses: { default: { content: { application/json: { schema: { type: object, example: { d: 1 } } } } } } } }');
    expect(dflt!.status).toBe(200);
    const only4xx = respond('openapi: 3.0.3\ninfo: { title: T, version: "1" }\npaths:\n  /x: { get: { responses: { "404": { content: { application/json: { schema: {} } } } } } }');
    expect(only4xx!.status).toBe(404);
  });
  it("no content → empty body; unknown route → undefined", () => {
    const noBody = respond('openapi: 3.0.3\ninfo: { title: T, version: "1" }\npaths:\n  /x: { get: { responses: { "204": { description: ok } } } }');
    expect(noBody!.body).toBe("");
    expect(respond('openapi: 3.0.3\ninfo: { title: T, version: "1" }\npaths:\n  /x: { get: { responses: { "200": {} } } }', "GET", "/nope")).toBeUndefined();
  });
});
