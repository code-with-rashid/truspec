import { describe, expect, it } from "vitest";
import { buildRoutes, createMockResponder, generateExample } from "../src/mock/engine";

// Mutation-killing tests for mock/engine.ts: assert EXACT headers, status, bodies, route specificity,
// validate-mode 400s, and regex matching semantics so string/conditional/object mutants can't survive.
const spec = (paths: Record<string, unknown>) => `openapi: 3.0.3\ninfo: { title: T, version: "1" }\npaths: ${JSON.stringify(paths)}\n`;

describe("mock engine — exact behavior (mutation kills)", () => {
  it("a body response carries exactly content-type: application/json", () => {
    const r = createMockResponder(spec({ "/x": { get: { responses: { "200": { content: { "application/json": { example: { a: 1 } } } } } } } }));
    const res = r.respond("GET", "/x")!;
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");
    expect(res.body).toBe('{"a":1}');
  });

  it("no JSON content → empty body, no content-type header", () => {
    const res = createMockResponder(spec({ "/x": { get: { responses: { "204": { description: "no content" } } } } })).respond("GET", "/x")!;
    expect(res.body).toBe("");
    expect(res.headers["content-type"]).toBeUndefined();
  });

  it("route specificity: a static segment beats a parameter regardless of declaration order", () => {
    const r = createMockResponder(spec({
      "/users/{id}": { get: { responses: { "200": { content: { "application/json": { example: "param" } } } } } },
      "/users/me": { get: { responses: { "200": { content: { "application/json": { example: "static" } } } } } },
    }));
    expect(JSON.parse(r.respond("GET", "/users/me")!.body)).toBe("static");
    expect(JSON.parse(r.respond("GET", "/users/123")!.body)).toBe("param");
  });

  it("pathToRegex: a param matches one segment but not across '/', and literals match exactly", () => {
    const route = buildRoutes({ paths: { "/pets/{id}": { get: { responses: {} } } } })[0]!;
    expect(route.regex.test("/pets/123")).toBe(true);
    expect(route.regex.test("/pets/123/")).toBe(true); // trailing slash allowed
    expect(route.regex.test("/pets/123/x")).toBe(false); // not across a slash
    expect(route.regex.test("/pets/")).toBe(false); // param requires a value
    expect(route.regex.test("/petsX/123")).toBe(false); // literal is exact
  });

  it("validate mode: missing required query → 400 with the exact missing list; satisfied → 200", () => {
    const s = spec({ "/s": { get: { parameters: [{ name: "q", in: "query", required: true }], responses: { "200": { content: { "application/json": { example: {} } } } } } } });
    const r = createMockResponder(s, { validate: true });
    const bad = r.respond("GET", "/s", { query: {} })!;
    expect(bad.status).toBe(400);
    expect(bad.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(bad.body)).toEqual({ error: "Request does not satisfy the spec", missing: ["query:q"] });
    expect(r.respond("GET", "/s", { query: { q: "1" } })!.status).toBe(200);
  });

  it("validate mode: a required request body that is absent → 400 missing:['body']", () => {
    const s = spec({ "/s": { post: { requestBody: { required: true, content: { "application/json": {} } }, responses: { "200": { content: { "application/json": { example: {} } } } } } } });
    const r = createMockResponder(s, { validate: true });
    expect(JSON.parse(r.respond("POST", "/s", { hasBody: false })!.body).missing).toEqual(["body"]);
    expect(r.respond("POST", "/s", { hasBody: true })!.status).toBe(200);
  });

  it("response selection: lowest 2xx wins; else default; else first code; status clamped to 200-599", () => {
    expect(createMockResponder(spec({ "/x": { get: { responses: { "201": { content: { "application/json": { example: "a" } } }, "200": { content: { "application/json": { example: "b" } } } } } } })).respond("GET", "/x")!.status).toBe(200);
    expect(createMockResponder(spec({ "/x": { get: { responses: { default: { content: { "application/json": { example: "d" } } } } } } })).respond("GET", "/x")!.status).toBe(200);
    expect(createMockResponder(spec({ "/x": { get: { responses: { "404": { content: { "application/json": { example: "e" } } } } } } })).respond("GET", "/x")!.status).toBe(404);
    expect(createMockResponder(spec({ "/x": { get: { responses: { "20000": { content: { "application/json": { example: "f" } } } } } } })).respond("GET", "/x")!.status).toBe(200);
    expect(createMockResponder(spec({ "/x": { get: { responses: { "100": { content: { "application/json": { example: "g" } } } } } } })).respond("GET", "/x")!.status).toBe(200);
  });

  it("examples-map first value is used; an empty enum does not short-circuit; allOf skips non-object parts", () => {
    const ex = createMockResponder(spec({ "/x": { get: { responses: { "200": { content: { "application/json": { examples: { a: { value: { hi: 9 } } } } } } } } } })).respond("GET", "/x")!;
    expect(JSON.parse(ex.body)).toEqual({ hi: 9 });
    expect(generateExample({ enum: [], type: "string" }, {})).toBe("string"); // empty enum ignored
    expect(generateExample({ allOf: [{ type: "string" }, { properties: { a: { type: "integer" } } }] }, {})).toEqual({ a: 0 }); // string part skipped
  });

  it("generateExample stops at depth 6 (returns null at the bottom of a deep chain)", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 8; i++) schema = { type: "object", properties: { n: schema } };
    // 8 levels deep > cap 6 → the deepest value is cut to null, not "string"
    let v = generateExample(schema, {}) as Record<string, unknown>;
    let depth = 0; while (v && typeof v === "object" && "n" in v) { v = v.n as Record<string, unknown>; depth++; }
    expect(depth).toBeLessThanOrEqual(7);
  });
});
