import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { bruToRequest, importPostman } from "../src/importers";

const wrap = (request: object) => ({ info: { name: "C" }, item: [{ name: "x", request }] });
const firstRequest = (input: object) => parse.request.parse(importPostman(input).files[0]?.content ?? "");

describe("postman auth + body variants", () => {
  it("basic auth", () => {
    const req = firstRequest(
      wrap({
        method: "GET",
        url: { raw: "http://x" },
        auth: { type: "basic", basic: [{ key: "username", value: "u" }, { key: "password", value: "p" }] },
      }),
    );
    expect(req.auth).toEqual({ type: "basic", username: "u", password: "p" });
  });

  it("apikey in query", () => {
    const req = firstRequest(
      wrap({
        method: "GET",
        url: { raw: "http://x" },
        auth: {
          type: "apikey",
          apikey: [{ key: "key", value: "k" }, { key: "value", value: "v" }, { key: "in", value: "query" }],
        },
      }),
    );
    expect(req.auth).toEqual({ type: "apikey", name: "k", value: "v", in: "query" });
  });

  it("urlencoded body", () => {
    const req = firstRequest(
      wrap({ method: "POST", url: { raw: "http://x" }, body: { mode: "urlencoded", urlencoded: [{ key: "a", value: "1" }] } }),
    );
    expect(req.body).toEqual({ type: "form", content: { a: "1" } });
  });

  it("formdata warns and imports as form fields", () => {
    const result = importPostman(
      wrap({ method: "POST", url: { raw: "http://x" }, body: { mode: "formdata", formdata: [{ key: "a", value: "1" }] } }),
    );
    expect(result.warnings.some((w) => /formdata/.test(w))).toBe(true);
  });

  it("graphql body without variables imports cleanly", () => {
    const req = firstRequest(
      wrap({ method: "POST", url: { raw: "http://x" }, body: { mode: "graphql", graphql: { query: "{ x }" } } }),
    );
    expect(req.body).toEqual({ type: "graphql", query: "{ x }" });
  });

  it("imports the Postman string-request shorthand", () => {
    const result = importPostman({
      info: { name: "C" },
      item: [{ name: "x", request: "GET https://api.test/x" }],
    });
    const req = parse.request.parse(result.files[0]?.content ?? "");
    expect(req.method).toBe("GET");
    expect(req.url).toBe("https://api.test/x");
  });

  it("invalid JSON raw body (template vars) falls back to text", () => {
    const req = firstRequest(
      wrap({
        method: "POST",
        url: { raw: "http://x" },
        body: { mode: "raw", raw: '{ "a": {{v}} }', options: { raw: { language: "json" } } },
      }),
    );
    expect(req.body?.type).toBe("text");
  });

  it("graphql body with stringified variables", () => {
    const req = firstRequest(
      wrap({
        method: "POST",
        url: { raw: "http://x/graphql" },
        body: { mode: "graphql", graphql: { query: "{ me }", variables: '{"a":1}' } },
      }),
    );
    expect(req.body).toEqual({ type: "graphql", query: "{ me }", variables: { a: 1 } });
  });

  it("an empty request name imports with a default instead of crashing the whole import", () => {
    // Postman exports legitimately contain empty names; `?? "Request"` doesn't catch "" and the
    // request schema requires name.min(1), so this used to throw out of the entire import.
    const result = importPostman({ item: [{ name: "", request: { method: "GET", url: "http://x" } }] });
    const req = parse.request.parse(result.files[0]?.content ?? "");
    expect(req.name).toBe("Request");
    expect(req.url).toBe("http://x");
  });
});

describe("bruno variants", () => {
  it("basic auth and json body", () => {
    const text = [
      "meta {",
      "  name: Create",
      "}",
      "post {",
      "  url: http://x",
      "  body: json",
      "  auth: basic",
      "}",
      "auth:basic {",
      "  username: u",
      "  password: p",
      "}",
      "body:json {",
      '  { "a": 1 }',
      "}",
    ].join("\n");
    const { request } = bruToRequest(text);
    expect(request?.method).toBe("POST");
    expect(request?.auth).toEqual({ type: "basic", username: "u", password: "p" });
    expect(request?.body).toEqual({ type: "json", content: { a: 1 } });
  });

  it("skips a request with no URL", () => {
    const { request, warnings } = bruToRequest("meta {\n  name: NoUrl\n}");
    expect(request).toBeUndefined();
    expect(warnings.some((w) => /no URL/.test(w))).toBe(true);
  });

  it("graphql body with vars", () => {
    const text = [
      "meta {",
      "  name: GQL",
      "}",
      "post {",
      "  url: http://x/graphql",
      "  body: graphql",
      "}",
      "body:graphql {",
      "  { me }",
      "}",
      "body:graphql:vars {",
      '  { "a": 1 }',
      "}",
    ].join("\n");
    const { request } = bruToRequest(text);
    expect(request?.body).toEqual({ type: "graphql", query: "{ me }", variables: { a: 1 } });
  });
});

describe("what a Bruno collection loses on the way in", () => {
  const bru = (...lines: string[]) => bruToRequest(lines.join("\n"));

  it("imports post-response vars as `capture` — the reason the collection has two requests", () => {
    // Dropped outright before this: the login still ran, the token was no longer saved, and every
    // request after it interpolated an undefined {{token}}. Nothing said so.
    const { request } = bru(
      "meta {",
      "  name: Login",
      "}",
      "post {",
      "  url: http://x/login",
      "}",
      "vars:post-response {",
      "  token: res.body.access_token",
      "  id: res.body.user.id",
      "  reqId: res.headers['x-request-id']",
      "  code: res.status",
      "}",
    );
    expect(request?.capture).toEqual({
      token: "$.access_token",
      id: "$.user.id",
      reqId: { header: "x-request-id" },
      code: { status: true },
    });
  });

  it("says so when a post-response var is an expression it cannot import", () => {
    const { request, warnings } = bru(
      "meta {\n  name: X\n}",
      "get {\n  url: http://x\n}",
      "vars:post-response {\n  n: res.body.items.length > 0 ? 1 : 0\n}",
    );
    expect(request?.capture).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/expression/);
  });

  it("converts the assert operators TruSpec has an exact equivalent for", () => {
    const { request, warnings } = bru(
      "meta {\n  name: A\n}",
      "get {\n  url: http://x\n}",
      "assert {",
      "  res.responseTime: lt 2000",
      "  res.body.id: neq null",
      "  res.body.count: gte 3",
      "  res.body.name: contains rex",
      "  res.body.items: isArray",
      "  res.headers['content-type']: contains json",
      "}",
    );
    expect(request?.assertions).toEqual([
      { type: "duration", ltMs: 2000 },
      { type: "jsonpath", path: "$.id", notEquals: null },
      { type: "jsonpath", path: "$.count", gte: 3 },
      { type: "jsonpath", path: "$.name", contains: "rex" },
      { type: "jsonpath", path: "$.items", valueType: "array" },
      { type: "header", name: "content-type", contains: "json" },
    ]);
    expect(warnings).toEqual([]);
  });

  it("covers the whole operator table, so a missing one is a failure rather than a warning", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["eq 5", { equals: 5 }],
      ["neq 5", { notEquals: 5 }],
      ["gt 1", { gt: 1 }],
      ["gte 1", { gte: 1 }],
      ["lt 9", { lt: 9 }],
      ["lte 9", { lte: 9 }],
      ["contains ex", { contains: "ex" }],
      ["matches ^a.*z$", { matches: "^a.*z$" }],
      ["length 3", { length: 3 }],
      ["isDefined", { exists: true }],
      ["isUndefined", { exists: false }],
      ["isNull", { equals: null }],
      ["isEmpty", { empty: true }],
      ["isNotEmpty", { empty: false }],
      ["isTruthy", { exists: true }],
      ["isString", { valueType: "string" }],
      ["isNumber", { valueType: "number" }],
      ["isBoolean", { valueType: "boolean" }],
      ["isArray", { valueType: "array" }],
    ];
    for (const [expr, expected] of cases) {
      const { request, warnings } = bru(
        "meta {\n  name: A\n}",
        "get {\n  url: http://x\n}",
        `assert {\n  res.body.f: ${expr}\n}`,
      );
      expect(warnings, expr).toEqual([]);
      expect(request?.assertions[0], expr).toEqual({ type: "jsonpath", path: "$.f", ...expected });
    }
  });

  it("converts the header and status operators, and warns about the rest", () => {
    const { request } = bru(
      "meta {\n  name: H\n}",
      "get {\n  url: http://x\n}",
      "assert {",
      "  res.status: gte 200",
      "  res.status: lt 300",
      "  res.headers['x-id']: eq abc",
      "  res.headers['x-id']: isDefined",
      "}",
    );
    expect(request?.assertions).toEqual([
      { type: "status", gte: 200 },
      { type: "status", lt: 300 },
      { type: "header", name: "x-id", equals: "abc" },
      { type: "header", name: "x-id", exists: true },
    ]);

    const { warnings } = bru(
      "meta {\n  name: H\n}",
      "get {\n  url: http://x\n}",
      "assert {",
      "  res.status: between 200 300",
      "  res.responseTime: gt 5",
      "  res.headers['x-id']: matches ^a",
      "  res.body.f: startsWith a",
      "  req.method: eq GET",
      "}",
    );
    expect(warnings).toHaveLength(5);
  });

  it("keeps two constraints on the same field", () => {
    // The lines were collapsed into a map keyed by the left-hand side, so `gte 200` + `lt 300`
    // became just `lt 300`: the import quietly halved what the request checked.
    const { request } = bru(
      "meta {\n  name: R\n}",
      "get {\n  url: http://x\n}",
      "assert {\n  res.body.n: gte 1\n  res.body.n: lte 9\n}",
    );
    expect(request?.assertions).toEqual([
      { type: "jsonpath", path: "$.n", gte: 1 },
      { type: "jsonpath", path: "$.n", lte: 9 },
    ]);
  });

  it("names pre-request vars rather than dropping them", () => {
    const { warnings } = bru(
      "meta {\n  name: P\n}",
      "get {\n  url: http://x\n}",
      "vars:pre-request {\n  nonce: uuid()\n}",
    );
    expect(warnings.join(" ")).toMatch(/pre-request vars \(nonce\)/);
  });

  it("does not send the same query parameter twice", () => {
    // Bruno keeps the query string and the query block in sync and shows them as one thing;
    // importing both produced ?expand=profile&expand=profile, which many APIs read as an array.
    const { request } = bru(
      "meta {\n  name: Q\n}",
      "get {\n  url: http://x/me?expand=profile\n}",
      "query {\n  expand: profile\n}",
    );
    expect(request?.url).toBe("http://x/me");
    expect(request?.query).toEqual({ expand: "profile" });
  });

  it("leaves a URL with a query string alone when there is no query block", () => {
    const { request } = bru("meta {\n  name: Q\n}", "get {\n  url: http://x/me?expand=profile\n}");
    expect(request?.url).toBe("http://x/me?expand=profile");
  });

  it("names a dropped tests block instead of swallowing it", () => {
    const { warnings } = bru(
      "meta {\n  name: T\n}",
      "get {\n  url: http://x\n}",
      'tests {\n  test("works", function() { expect(1).to.equal(1); });\n}',
    );
    expect(warnings.join(" ")).toMatch(/tests block not imported/);
  });
});
