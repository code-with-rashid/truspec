import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { evaluateAssertion, type ResponseView } from "../src/runner";

const body = {
  id: 7,
  name: "Rex",
  tags: ["good", "dog"],
  score: 4.5,
  owner: null,
  meta: {},
  empty: [],
};

const res: ResponseView = {
  status: 200,
  headers: { "content-type": "application/json; charset=utf-8", "x-request-id": "abc-123" },
  bodyText: JSON.stringify(body),
  json: body,
  durationMs: 12,
};

/** Parse one assertion through the real schema, so these tests also pin the schema down. */
function assertion(yaml: string) {
  const req = parse.request.parse(`name: r\nurl: "https://x.test"\nassertions:\n  - ${yaml}`);
  return req.assertions[0] as Exclude<(typeof req.assertions)[number], { type: "schema" }>;
}

const evaluate = (yaml: string) => evaluateAssertion(assertion(yaml), res);
const passes = (yaml: string) => evaluate(yaml).ok;

describe("jsonpath comparators", () => {
  it("compares numbers with gt / gte / lt / lte", () => {
    expect(passes('{ type: jsonpath, path: "$.id", gt: 6 }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.id", gt: 7 }')).toBe(false);
    expect(passes('{ type: jsonpath, path: "$.id", gte: 7, lte: 7 }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.score", lt: 5 }')).toBe(true);
  });

  it("fails a numeric comparison against a non-number rather than coercing it", () => {
    expect(passes('{ type: jsonpath, path: "$.name", gt: 0 }')).toBe(false);
  });

  it("checks notEquals across every match", () => {
    expect(passes('{ type: jsonpath, path: "$.name", notEquals: "Fido" }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.name", notEquals: "Rex" }')).toBe(false);
  });

  it("checks membership with oneOf", () => {
    expect(passes('{ type: jsonpath, path: "$.name", oneOf: ["Rex", "Fido"] }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.name", oneOf: ["Fido"] }')).toBe(false);
  });

  it("contains means substring for a string and membership for an array", () => {
    expect(passes('{ type: jsonpath, path: "$.name", contains: "Re" }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.tags", contains: "dog" }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.tags", contains: "cat" }')).toBe(false);
  });

  it("checks the JSON type, distinguishing null and array from object", () => {
    expect(passes('{ type: jsonpath, path: "$.id", valueType: number }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.tags", valueType: array }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.tags", valueType: object }')).toBe(false);
    expect(passes('{ type: jsonpath, path: "$.owner", valueType: "null" }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.meta", valueType: object }')).toBe(true);
  });

  it("checks exact, minimum and maximum length of strings and arrays", () => {
    expect(passes('{ type: jsonpath, path: "$.tags", length: 2 }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.name", length: 3 }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.tags", minLength: 1, maxLength: 5 }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.tags", minLength: 3 }')).toBe(false);
    // A number has no length; the check fails rather than passing vacuously.
    expect(passes('{ type: jsonpath, path: "$.id", maxLength: 10 }')).toBe(false);
  });

  it("checks emptiness for strings, arrays and objects", () => {
    expect(passes('{ type: jsonpath, path: "$.empty", empty: true }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.meta", empty: true }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.tags", empty: false }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.tags", empty: true }')).toBe(false);
  });

  it("combines conditions as an AND", () => {
    expect(passes('{ type: jsonpath, path: "$.id", valueType: number, gte: 1, lte: 10 }')).toBe(true);
    expect(passes('{ type: jsonpath, path: "$.id", valueType: number, gte: 100 }')).toBe(false);
  });
});

describe("assertion messages", () => {
  it("names the value that was actually there, and only the conditions that failed", () => {
    const r = evaluate('{ type: jsonpath, path: "$.id", equals: 7, gt: 100 }');
    expect(r.ok).toBe(false);
    expect(r.message).toBe("jsonpath $.id → 7 fails > 100");
  });

  it("reports a missing path as (no match) rather than as undefined", () => {
    const r = evaluate('{ type: jsonpath, path: "$.nope", exists: true }');
    expect(r.message).toBe("jsonpath $.nope → (no match) fails exists");
  });

  it("lists every condition when the assertion passes", () => {
    expect(evaluate('{ type: jsonpath, path: "$.name", equals: "Rex" }').message).toBe(
      'jsonpath $.name → "Rex" satisfies == "Rex"',
    );
  });

  it("shows a header's actual value, and (absent) when there is none", () => {
    expect(evaluate('{ type: header, name: X-Request-Id, equals: "nope" }').message).toBe(
      'header "X-Request-Id" "abc-123" fails == "nope"',
    );
    expect(evaluate('{ type: header, name: X-Missing, exists: true }').message).toBe(
      'header "X-Missing" (absent) fails exists',
    );
  });

  it("truncates a long value instead of dumping it into the log", () => {
    const long = { note: "x".repeat(500) };
    const r = evaluateAssertion(assertion('{ type: jsonpath, path: "$.note", equals: "y" }'), {
      ...res,
      json: long,
    });
    expect(r.message.length).toBeLessThan(200);
    expect(r.message).toContain("…");
  });
});

describe("header conditions", () => {
  it("supports contains and notEquals alongside the existing checks", () => {
    expect(passes('{ type: header, name: content-type, contains: "json" }')).toBe(true);
    expect(passes('{ type: header, name: content-type, contains: "xml" }')).toBe(false);
    expect(passes('{ type: header, name: content-type, notEquals: "text/plain" }')).toBe(true);
    expect(passes('{ type: header, name: X-Missing, contains: "a" }')).toBe(false);
  });

  it("matches header names case-insensitively", () => {
    expect(passes('{ type: header, name: Content-Type, exists: true }')).toBe(true);
  });
});

describe("body conditions", () => {
  it("supports equals, notContains and empty", () => {
    expect(passes(`{ type: body, contains: "Rex" }`)).toBe(true);
    expect(passes(`{ type: body, notContains: "Fido" }`)).toBe(true);
    expect(passes(`{ type: body, notContains: "Rex" }`)).toBe(false);
    expect(passes(`{ type: body, empty: false }`)).toBe(true);
    expect(
      evaluateAssertion(assertion('{ type: body, empty: true }'), { ...res, bodyText: "" }).ok,
    ).toBe(true);
    expect(
      evaluateAssertion(assertion('{ type: body, equals: "ok" }'), { ...res, bodyText: "ok" }).ok,
    ).toBe(true);
  });

  it("reports the body size in the message", () => {
    expect(evaluate(`{ type: body, contains: "Fido" }`).message).toMatch(/^body \(\d+ bytes\) fails/);
  });
});

describe("schema strictness", () => {
  it("still rejects an unknown condition key, so a typo is not silently ignored", () => {
    expect(() => assertion('{ type: jsonpath, path: "$.id", greaterThan: 1 }')).toThrow();
    expect(() => assertion('{ type: body, doesNotContain: "x" }')).toThrow();
  });

  it("rejects an assertion with no condition at all rather than passing it", () => {
    expect(passes('{ type: jsonpath, path: "$.id" }')).toBe(false);
    expect(passes("{ type: body }")).toBe(false);
  });
});
