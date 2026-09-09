import { describe, expect, it } from "vitest";
import { describeAssertion, describeCaptureSource, parse } from "../src/format";

/** Parse through the schema, so a description can never be written for a shape that cannot exist. */
const assertion = (yaml: string) =>
  parse.request.parse(`name: r\nurl: "http://x"\nassertions:\n  - ${yaml}\n`).assertions[0]!;

describe("an assertion, in the words a person would use", () => {
  // `truspec docs` printed the internal object — `{"type":"jsonpath","path":"$.id","exists":true}`
  // — in the one artifact whose entire purpose is being read by someone without the schema open.
  it.each([
    ["{ type: status, equals: 201 }", "status is 201"],
    ["{ type: status, in: [200, 204] }", "status is one of 200, 204"],
    ["{ type: status, gte: 200, lt: 300 }", "status is under 300 and is at least 200"],
    ["{ type: duration, ltMs: 2000 }", "responds in under 2000ms"],
    ['{ type: jsonpath, path: "$.id", exists: true }', "`$.id` exists"],
    ['{ type: jsonpath, path: "$.name", equals: "Rex" }', '`$.name` is "Rex"'],
    ['{ type: jsonpath, path: "$.n", gte: 1, lte: 9 }', "`$.n` ≥ 1 and ≤ 9"],
    ['{ type: jsonpath, path: "$.items", valueType: array, minLength: 1 }', "`$.items` is a array and has length ≥ 1"],
    ['{ type: header, name: X-Id, exists: true }', "header `X-Id` exists"],
    ['{ type: header, name: Content-Type, contains: json }', 'header `Content-Type` contains "json"'],
    ['{ type: body, matches: "^ok" }', "body matches /^ok/"],
    ["{ type: body, empty: false }", "body is not empty"],
    ["{ type: schema }", "body matches the spec's response schema"],
    ['{ type: schema, status: 201, contentType: "application/json" }', "body matches the spec's response schema for status 201 as application/json"],
  ])("%s → %s", (yaml, expected) => {
    expect(describeAssertion(assertion(yaml))).toBe(expected);
  });

  it("never returns an empty string, whatever the assertion carries", () => {
    // A bare `{ type: header, name: X }` asserts presence and must still say something.
    expect(describeAssertion(assertion("{ type: header, name: X }"))).toBe("header `X` is present");
    expect(describeAssertion(assertion('{ type: jsonpath, path: "$" }'))).toBe("`$` is present");
  });

  it("describes where a captured value comes from", () => {
    expect(describeCaptureSource("$.access_token")).toBe("`$.access_token`");
    expect(describeCaptureSource({ jsonpath: "$.id" })).toBe("`$.id`");
    expect(describeCaptureSource({ header: "X-Request-Id" })).toBe("header `X-Request-Id`");
    expect(describeCaptureSource({ status: true })).toBe("the response status");
  });
});
