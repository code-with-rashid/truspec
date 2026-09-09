import { describe, expect, it } from "vitest";
import { evaluateAssertion, explainJsonPathMiss, type ResponseView } from "../src/runner";

const body = {
  id: 7,
  name: "Rex",
  tags: ["good", "dog"],
  owner: { id: 1, email: "sam@x.test" },
  meta: {},
};

const view = (json: unknown): ResponseView => ({
  status: 200,
  headers: {},
  bodyText: JSON.stringify(json ?? null),
  json,
  durationMs: 1,
});

describe("why a jsonpath matched nothing", () => {
  // "(no match)" is true and useless: it does not say whether the field is missing, its parent is
  // missing, the body was not JSON, or an index ran off an array — so the next step was always to
  // go and read the body by hand.
  it.each([
    ["$.missing", '$ has no "missing"; keys: id, name, tags, owner, meta'],
    ["$.missing.deep", '$ has no "missing"; keys: id, name, tags, owner, meta'],
    ["$.owner.nickname", '$.owner has no "nickname"; keys: id, email'],
    ["$.meta.anything", '$.meta has no "anything"; it has no keys'],
    ["$.name.first", "$.name is a string, not an object"],
    ["$.name[0]", "$.name is a string, not an array"],
    ["$.tags.id", "$.tags is an array — index it with [n] or [*]"],
    ["$.tags[9]", "$.tags has 2 item(s)"],
    ["$.owner[0]", "$.owner is an object, not an array"],
  ])("%s → %s", (path, expected) => {
    expect(explainJsonPathMiss(body, path)).toBe(expected);
  });

  it("does not guess which element of a wildcard was meant", () => {
    expect(explainJsonPathMiss(body, "$.tags[*].id")).toBe('no element of $.tags[*] has "id"');
  });

  it("says when there was no JSON to search at all", () => {
    expect(explainJsonPathMiss(undefined, "$.id")).toBe("the response body is not JSON");
  });

  it("names an empty array rather than claiming an item count", () => {
    expect(explainJsonPathMiss({ items: [] }, "$.items[0]")).toBe("$.items is empty");
  });

  it("explains nothing when the path does match", () => {
    expect(explainJsonPathMiss(body, "$.owner.email")).toBeUndefined();
    expect(explainJsonPathMiss(body, "$")).toBeUndefined();
  });

  it("stays quiet about a path it cannot parse, rather than inventing a reason", () => {
    expect(explainJsonPathMiss(body, "no-dollar")).toBeUndefined();
    expect(explainJsonPathMiss(body, "$.[")).toBeUndefined();
  });

  it("reaches the assertion message, which is the point", () => {
    const r = evaluateAssertion({ type: "jsonpath", path: "$.ownr.email", exists: true }, view(body));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('no match — $ has no "ownr"');
    expect(r.message).toContain("keys: id, name, tags, owner, meta");
  });

  it("leaves a matching assertion's message alone", () => {
    const r = evaluateAssertion({ type: "jsonpath", path: "$.name", equals: "Rex" }, view(body));
    expect(r.message).not.toContain("no match");
  });

  it("truncates a long key list instead of printing the whole object", () => {
    const wide = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i]));
    expect(explainJsonPathMiss(wide, "$.nope")).toBe(
      '$ has no "nope"; keys: k0, k1, k2, k3, k4, …4 more',
    );
  });
});
