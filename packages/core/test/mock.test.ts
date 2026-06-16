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
