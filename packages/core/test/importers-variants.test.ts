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
