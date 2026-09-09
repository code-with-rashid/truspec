import { describe, expect, it } from "vitest";
import { captureValues, evaluateCaptures, type ResponseView } from "../src/runner";

const view = (json: unknown, headers: Record<string, string> = {}): ResponseView => ({
  status: 201,
  headers,
  bodyText: JSON.stringify(json ?? null),
  json,
  durationMs: 3,
});

describe("a capture that matched nothing", () => {
  // The most confusing failure in a chained collection: the login passes, and a request three
  // files later fails with "Unresolved variables: {{token}}" — naming the consumer, not the
  // producer, and saying nothing about which of the two is wrong.
  it("is reported against the request that should have produced it, with the reason", () => {
    const { values, missed } = captureValues(
      { token: "$.access_token" },
      view({ token_value: "abc123" }),
    );
    expect(values).toEqual({});
    expect(missed).toEqual([
      {
        name: "token",
        source: "$.access_token",
        reason: '$ has no "access_token"; keys: token_value',
      },
    ]);
  });

  it("says nothing when every capture found a value", () => {
    const { values, missed } = captureValues(
      { token: "$.access_token", id: { jsonpath: "$.user.id" }, code: { status: true } },
      view({ access_token: "t", user: { id: 9 } }),
    );
    expect(values).toEqual({ token: "t", id: 9, code: 201 });
    expect(missed).toEqual([]);
  });

  it("names a missing header in the words the file uses", () => {
    const { missed } = captureValues({ rid: { header: "X-Request-Id" } }, view({}));
    expect(missed).toEqual([
      { name: "rid", source: "header X-Request-Id", reason: "the response has no X-Request-Id header" },
    ]);
  });

  it("reports a jsonpath capture against a non-JSON body", () => {
    const { missed } = captureValues({ token: "$.a" }, { ...view(undefined), json: undefined });
    expect(missed[0]?.reason).toBe("the response body is not JSON");
  });

  it("captures a header case-insensitively, as HTTP does", () => {
    const { values, missed } = captureValues(
      { rid: { header: "X-Request-Id" } },
      view({}, { "x-request-id": "abc" }),
    );
    expect(values).toEqual({ rid: "abc" });
    expect(missed).toEqual([]);
  });

  it("keeps the old shape available for callers that only want the values", () => {
    expect(evaluateCaptures({ id: "$.id" }, view({ id: 4 }))).toEqual({ id: 4 });
  });
});
