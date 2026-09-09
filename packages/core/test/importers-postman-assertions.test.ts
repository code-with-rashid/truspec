import { describe, expect, it } from "vitest";
import { assertionsFromPostmanTest } from "../src/importers/postman-assertions";

const recover = (script: string) => assertionsFromPostmanTest(script);

describe("assertions recovered from a Postman test script", () => {
  it("reads the idiom Postman's own snippet menu produces", () => {
    // This is the most-pasted test script in existence; if nothing else works, this must.
    const { assertions, complete } = recover(`pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});`);
    expect(assertions).toEqual([{ type: "status", equals: 200 }]);
    expect(complete).toBe(true);
  });

  it("reads hand-written status checks in their common spellings", () => {
    expect(recover("pm.expect(pm.response.code).to.eql(201);").assertions).toEqual([
      { type: "status", equals: 201 },
    ]);
    expect(recover("pm.expect(pm.response.code).to.equal(204);").assertions).toEqual([
      { type: "status", equals: 204 },
    ]);
    expect(recover("pm.expect(pm.response.code).to.be.oneOf([200, 201]);").assertions).toEqual([
      { type: "status", in: [200, 201] },
    ]);
    expect(recover("pm.expect(pm.response.code).to.be.below(400);").assertions).toEqual([
      { type: "status", lt: 400 },
    ]);
  });

  it("reads a response-time check", () => {
    expect(recover("pm.expect(pm.response.responseTime).to.be.below(500);").assertions).toEqual([
      { type: "duration", ltMs: 500 },
    ]);
  });

  it("reads header checks, including a negated one", () => {
    expect(recover('pm.response.to.have.header("Content-Type");').assertions).toEqual([
      { type: "header", name: "Content-Type", exists: true },
    ]);
    expect(recover('pm.expect(pm.response.headers.get("X-Env")).to.eql("prod");').assertions).toEqual([
      { type: "header", name: "X-Env", equals: "prod" },
    ]);
    expect(recover('pm.expect(pm.response.headers.get("X-Env")).to.not.eql("dev");').assertions).toEqual([
      { type: "header", name: "X-Env", notEquals: "dev" },
    ]);
  });

  it("reads body checks", () => {
    expect(recover('pm.expect(pm.response.text()).to.include("ok");').assertions).toEqual([
      { type: "body", contains: "ok" },
    ]);
    expect(recover('pm.expect(pm.response.text()).to.not.include("error");').assertions).toEqual([
      { type: "body", notContains: "error" },
    ]);
  });

  it("reads a plain accessor chain off a json variable, whatever it is called", () => {
    // `var jsonData = pm.response.json()` is the shape Postman's own snippets use; the variable
    // declaration itself carries no assertion and must not count as leftover.
    const { assertions, complete } = recover(`var jsonData = pm.response.json();
pm.test("id is 5", function () {
    pm.expect(jsonData.data.id).to.eql(5);
});`);
    expect(assertions).toEqual([{ type: "jsonpath", path: "$.data.id", equals: 5 }]);
    expect(complete).toBe(true);
  });

  it("reads an indexed path and a lodash accessor alike", () => {
    expect(recover('pm.expect(json.items[0].name).to.eql("a");').assertions).toEqual([
      { type: "jsonpath", path: "$.items[0].name", equals: "a" },
    ]);
    expect(recover('pm.expect(_.get(json, "items[0].name")).to.eql("a");').assertions).toEqual([
      { type: "jsonpath", path: "$.items[0].name", equals: "a" },
    ]);
  });

  it("reports leftovers instead of pretending a script was fully understood", () => {
    // The whole point: a guessed assertion is worse than an honest gap, so anything unrecognised
    // keeps the ported comment alive for a human to read.
    const { assertions, complete } = recover(`pm.test("complicated", function () {
    const total = pm.response.json().items.reduce((a, b) => a + b.qty, 0);
    pm.expect(total).to.be.above(10);
    pm.response.to.have.status(200);
});`);
    expect(assertions).toEqual([{ type: "status", equals: 200 }]);
    expect(complete).toBe(false);
  });

  it("recovers nothing, and claims nothing, from a script it does not understand at all", () => {
    const { assertions, complete } = recover("postman.setEnvironmentVariable('token', pm.response.json().token);");
    expect(assertions).toEqual([]);
    expect(complete).toBe(false);
  });

  it("ignores comments and blank lines", () => {
    const { assertions, complete } = recover(`// check the status

pm.response.to.have.status(200);
`);
    expect(assertions).toEqual([{ type: "status", equals: 200 }]);
    expect(complete).toBe(true);
  });

  it("handles single-quoted strings, which are valid JS and invalid JSON", () => {
    expect(recover("pm.response.to.have.header('X-Id');").assertions).toEqual([
      { type: "header", name: "X-Id", exists: true },
    ]);
    expect(recover("pm.expect(pm.response.text()).to.include('ok');").assertions).toEqual([
      { type: "body", contains: "ok" },
    ]);
  });
});

describe("the chain a Postman collection is built on", () => {
  // `pm.environment.set("token", jsonData.access_token)` is how every Postman collection passes a
  // login's token to the requests after it. It was imported as a commented-out script: the login
  // ran, nothing was saved, and every request after it interpolated a variable that never existed.
  it("recovers captures from the four ways Postman sets a variable", () => {
    const { capture, complete } = assertionsFromPostmanTest(
      [
        "const jsonData = pm.response.json();",
        'pm.environment.set("token", jsonData.access_token);',
        'pm.collectionVariables.set("userId", jsonData.user.id);',
        'pm.globals.set("reqId", pm.response.headers.get("X-Request-Id"));',
        'pm.variables.set("code", pm.response.code);',
      ].join("\n"),
    );
    expect(capture).toEqual({
      token: "$.access_token",
      userId: "$.user.id",
      reqId: { header: "X-Request-Id" },
      code: { status: true },
    });
    expect(complete).toBe(true);
  });

  it("reads the other shapes a path is written in", () => {
    const { capture } = assertionsFromPostmanTest(
      [
        'pm.environment.set("a", pm.response.json().data.items[0].id);',
        'pm.environment.set("b", _.get(json, "user.name"));',
        'pm.environment.set("c", json["first"].second);',
      ].join("\n"),
    );
    expect(capture).toEqual({
      a: "$.data.items[0].id",
      b: "$.user.name",
      c: "$.first.second",
    });
  });

  it("leaves a computed value to the human instead of guessing", () => {
    const { capture, complete } = assertionsFromPostmanTest(
      'pm.environment.set("n", jsonData.items.length + 1);',
    );
    expect(capture).toEqual({});
    expect(complete).toBe(false);
  });

  it("does not read an unrelated local as a response path", () => {
    const { capture, complete } = assertionsFromPostmanTest(
      ["const cfg = { id: 1 };", 'pm.environment.set("x", cfg.id);'].join("\n"),
    );
    expect(capture).toEqual({});
    expect(complete).toBe(false);
  });

  it("converts a single-line pm.test wrapper", () => {
    // As common as the block form, and skipped entirely: the line starts with `pm.test(`, which
    // the structural check treated as an opening brace with nothing in it.
    const { assertions, complete } = assertionsFromPostmanTest(
      'pm.test("status is 200", function () { pm.response.to.have.status(200); });',
    );
    expect(assertions).toEqual([{ type: "status", equals: 200 }]);
    expect(complete).toBe(true);
  });

  it("converts an arrow-function one-liner too", () => {
    const { assertions } = assertionsFromPostmanTest(
      'pm.test("fast", () => { pm.expect(pm.response.responseTime).to.be.below(500); });',
    );
    expect(assertions).toEqual([{ type: "duration", ltMs: 500 }]);
  });

  it("still reports a one-liner it cannot convert", () => {
    const { assertions, complete } = assertionsFromPostmanTest(
      'pm.test("weird", function () { pm.expect(somethingElse()).to.be.ok; });',
    );
    expect(assertions).toEqual([]);
    expect(complete).toBe(false);
  });
});
