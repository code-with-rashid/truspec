import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { createMockResponder, generateExample, startMockServer } from "../src/mock";

const specText = readFileSync(
  resolve(import.meta.dirname, "..", "..", "..", "examples", "petstore", "openapi.yaml"),
  "utf8",
);

describe("generateExample", () => {
  const doc = parseYaml(specText);
  it("resolves $ref and field-level examples", () => {
    expect(generateExample({ $ref: "#/components/schemas/Pet" }, doc)).toEqual({
      id: 1,
      name: "Rex",
      tag: "string",
    });
  });
  it("generates by type with format awareness", () => {
    expect(generateExample({ type: "string", format: "email" }, {})).toBe("user@example.com");
    expect(generateExample({ type: "string", format: "date-time" }, {})).toBe("2026-01-01T00:00:00Z");
    expect(generateExample({ type: "integer" }, {})).toBe(0);
    expect(generateExample({ type: "boolean" }, {})).toBe(true);
    expect(generateExample({ type: "array", items: { type: "string" } }, {})).toEqual(["string"]);
    expect(generateExample({ enum: ["a", "b"] }, {})).toBe("a");
  });
});

describe("mock responder", () => {
  const responder = createMockResponder(specText);

  it("builds a route per operation", () => {
    expect(responder.routes).toHaveLength(3);
  });
  it("matches path params and returns a generated example", () => {
    const res = responder.respond("GET", "/pets/42");
    expect(res?.status).toBe(200);
    expect(JSON.parse(res?.body ?? "")).toEqual({ id: 1, name: "Rex", tag: "string" });
  });
  it("returns an array for list and 201 for create", () => {
    expect(JSON.parse(responder.respond("GET", "/pets")?.body ?? "")).toEqual([
      { id: 1, name: "Rex", tag: "string" },
    ]);
    expect(responder.respond("POST", "/pets")?.status).toBe(201);
  });
  it("misses unknown routes", () => {
    expect(responder.respond("DELETE", "/pets/1")).toBeUndefined();
  });
});

describe("startMockServer", () => {
  it("serves mock responses over HTTP", async () => {
    const handle = await startMockServer(specText, { port: 0 });
    try {
      expect(handle.routes).toBe(3);
      const ok = await fetch(`${handle.url}/pets/1`);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ id: 1, name: "Rex", tag: "string" });
      const miss = await fetch(`${handle.url}/nope`);
      expect(miss.status).toBe(404);
    } finally {
      await handle.close();
    }
  });

  it("applies a response delay", async () => {
    const handle = await startMockServer(specText, { port: 0, delayMs: 30 });
    try {
      const start = Date.now();
      const res = await fetch(`${handle.url}/pets/1`);
      expect(res.status).toBe(200);
      expect(Date.now() - start).toBeGreaterThanOrEqual(20);
    } finally {
      await handle.close();
    }
  });
});

describe("mock validation", () => {
  const SPEC = `
openapi: 3.0.3
info: { title: T, version: "1.0.0" }
paths:
  /search:
    get:
      operationId: search
      parameters: [ { name: q, in: query, required: true } ]
      responses: { "200": { description: ok } }
`.trim();

  it("400s a request missing a required query param when validate is on", () => {
    const responder = createMockResponder(SPEC, { validate: true });
    expect(responder.respond("GET", "/search", { query: {} })?.status).toBe(400);
    expect(responder.respond("GET", "/search", { query: { q: "x" } })?.status).toBe(200);
  });

  it("does not validate when validate is off", () => {
    const responder = createMockResponder(SPEC);
    expect(responder.respond("GET", "/search", { query: {} })?.status).toBe(200);
  });
});

describe("mock route specificity", () => {
  // Regression: a literal route declared AFTER a parametric one used to be unreachable, because
  // `respond` returned the first regex match in document order. A static segment must beat a param.
  const spec = (order: "paramFirst" | "literalFirst") => {
    const byId = `
  /users/{id}:
    get:
      responses:
        "200": { content: { application/json: { schema: { type: object, properties: { kind: { type: string, example: byId } } } } } }`;
    const me = `
  /users/me:
    get:
      responses:
        "200": { content: { application/json: { schema: { type: object, properties: { kind: { type: string, example: me } } } } } }`;
    return `openapi: 3.0.3\ninfo: { title: T, version: "1" }\npaths:${order === "paramFirst" ? byId + me : me + byId}\n`;
  };

  for (const order of ["paramFirst", "literalFirst"] as const) {
    it(`routes /users/me to the literal route (declared ${order})`, () => {
      const r = createMockResponder(spec(order));
      expect(JSON.parse(r.respond("GET", "/users/me")?.body ?? "{}").kind).toBe("me");
      // …and a genuine id still hits the parametric route.
      expect(JSON.parse(r.respond("GET", "/users/42")?.body ?? "{}").kind).toBe("byId");
    });
  }
});
