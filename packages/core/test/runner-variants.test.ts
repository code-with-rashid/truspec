import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { evaluateAssertion, resolveRequest } from "../src/runner";

describe("resolveRequest auth + body variants", () => {
  it("basic auth → Authorization header", () => {
    const r = parse.request.parse("name: r\nurl: http://x\nauth: { type: basic, username: u, password: p }");
    const eff = resolveRequest(r, {});
    expect(eff.headers.Authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
  });

  it("apikey in header", () => {
    const r = parse.request.parse("name: r\nurl: http://x\nauth: { type: apikey, name: X-Key, value: secret }");
    expect(resolveRequest(r, {}).headers["X-Key"]).toBe("secret");
  });

  it("text body sets text/plain and interpolates", () => {
    const r = parse.request.parse('name: r\nmethod: POST\nurl: http://x\nbody: { type: text, content: "hi {{n}}" }');
    const eff = resolveRequest(r, { vars: { n: "5" } });
    expect(eff.body).toBe("hi 5");
    expect(eff.headers["Content-Type"]).toBe("text/plain");
  });

  it("form body urlencodes", () => {
    const r = parse.request.parse('name: r\nmethod: POST\nurl: http://x\nbody: { type: form, content: { a: "1", b: two } }');
    const eff = resolveRequest(r, {});
    expect(eff.body).toBe("a=1&b=two");
    expect(eff.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("none body omits the body", () => {
    const r = parse.request.parse("name: r\nurl: http://x\nbody: { type: none }");
    expect(resolveRequest(r, {}).body).toBeUndefined();
  });

  it("does not override an explicit content-type", () => {
    const r = parse.request.parse(
      "name: r\nmethod: POST\nurl: http://x\nheaders: { Content-Type: application/vnd.api+json }\nbody: { type: json, content: { a: 1 } }",
    );
    expect(resolveRequest(r, {}).headers["Content-Type"]).toBe("application/vnd.api+json");
  });

  it("graphql body posts query + variables as JSON", () => {
    const r = parse.request.parse(
      'name: r\nmethod: POST\nurl: http://x\nbody: { type: graphql, query: "{ me }", variables: { id: "{{id}}" } }',
    );
    const eff = resolveRequest(r, { vars: { id: "7" } });
    expect(JSON.parse(eff.body ?? "")).toEqual({ query: "{ me }", variables: { id: "7" } });
    expect(eff.headers["Content-Type"]).toBe("application/json");
  });
});

describe("assertion variants", () => {
  const res = { status: 204, headers: { "x-trace": "abc" }, bodyText: "hello world", durationMs: 10 };

  it("status in / lt / gte", () => {
    expect(evaluateAssertion({ type: "status", in: [200, 204] }, res).ok).toBe(true);
    expect(evaluateAssertion({ type: "status", lt: 300, gte: 200 }, res).ok).toBe(true);
    expect(evaluateAssertion({ type: "status", lt: 200 }, res).ok).toBe(false);
  });

  it("header exists / equals", () => {
    expect(evaluateAssertion({ type: "header", name: "X-Trace", exists: true }, res).ok).toBe(true);
    expect(evaluateAssertion({ type: "header", name: "missing", exists: false }, res).ok).toBe(true);
    expect(evaluateAssertion({ type: "header", name: "X-Trace", equals: "abc" }, res).ok).toBe(true);
  });

  it("body contains / matches", () => {
    expect(evaluateAssertion({ type: "body", contains: "world" }, res).ok).toBe(true);
    expect(evaluateAssertion({ type: "body", matches: "^hello" }, res).ok).toBe(true);
    expect(evaluateAssertion({ type: "body", contains: "nope" }, res).ok).toBe(false);
  });

  it("jsonpath matches regex and handles absent json", () => {
    expect(evaluateAssertion({ type: "jsonpath", path: "$.email", matches: "@" }, { ...res, json: { email: "a@b.com" } }).ok).toBe(true);
    expect(evaluateAssertion({ type: "jsonpath", path: "$.x", exists: true }, res).ok).toBe(false);
  });
});
