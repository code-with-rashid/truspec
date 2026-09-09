import { describe, expect, it } from "vitest";
import { assertionsToPostmanTest } from "../src/exporters/postman-tests";
import type { TruSpecAssertion } from "../src/format/types";

function render(assertions: TruSpecAssertion[]): { script: string; warnings: string[] } {
  const warnings: string[] = [];
  const script = assertionsToPostmanTest(assertions, "R", (m) => warnings.push(m)).join("\n");
  return { script, warnings };
}

describe("assertions become Postman tests", () => {
  it("maps every status form", () => {
    const { script } = render([
      { type: "status", equals: 201 },
      { type: "status", in: [200, 204] },
      { type: "status", lt: 400, gte: 200 },
    ]);
    expect(script).toContain("pm.response.to.have.status(201);");
    expect(script).toContain("pm.expect([200,204]).to.include(pm.response.code);");
    expect(script).toContain("pm.expect(pm.response.code).to.be.below(400);");
    expect(script).toContain("pm.expect(pm.response.code).to.be.at.least(200);");
  });

  it("maps header assertions, including the negative forms", () => {
    const { script } = render([
      { type: "header", name: "X-Id", exists: true },
      { type: "header", name: "X-Gone", exists: false },
      { type: "header", name: "Content-Type", contains: "json" },
      { type: "header", name: "X-Env", notEquals: "prod" },
      { type: "header", name: "X-Trace", matches: "^[a-f0-9]+$" },
    ]);
    expect(script).toContain('pm.response.to.have.header("X-Id");');
    expect(script).toContain('pm.expect(pm.response.headers.get("X-Gone")).to.be.oneOf([null, undefined]);');
    expect(script).toContain('to.include("json")');
    expect(script).toContain('to.not.eql("prod")');
    expect(script).toContain('to.match(new RegExp("^[a-f0-9]+$"))');
  });

  it("maps body and duration", () => {
    const { script } = render([
      { type: "body", contains: "ok", notContains: "error" },
      { type: "body", empty: false },
      { type: "duration", ltMs: 1000 },
    ]);
    expect(script).toContain('pm.expect(pm.response.text()).to.include("ok");');
    expect(script).toContain('pm.expect(pm.response.text()).to.not.include("error");');
    expect(script).toContain('pm.expect(pm.response.text()).to.not.eql("");');
    expect(script).toContain("pm.expect(pm.response.responseTime).to.be.below(1000);");
  });

  it("translates a simple jsonpath to the lodash accessor Postman ships", () => {
    const { script, warnings } = render([
      { type: "jsonpath", path: "$.data.items[0].id", exists: true },
      { type: "jsonpath", path: "$.count", gte: 1, valueType: "number" },
      { type: "jsonpath", path: "$.tags", minLength: 2 },
    ]);
    expect(script).toContain('_.get(json, "data.items[0].id")');
    expect(script).toContain('pm.expect(_.get(json, "count")).to.be.at.least(1);');
    expect(script).toContain('pm.expect(_.get(json, "count")).to.be.a("number");');
    expect(script).toContain('pm.expect(_.get(json, "tags")).to.have.lengthOf.at.least(2);');
    expect(warnings).toEqual([]);
  });

  it("addresses the whole body for a bare $", () => {
    const { script } = render([{ type: "jsonpath", path: "$", valueType: "array" }]);
    expect(script).toContain('pm.expect(json).to.be.an("array");');
  });

  it("warns instead of emitting a wrong test for a jsonpath it cannot express", () => {
    // A filter or wildcard has no lodash equivalent. A silently wrong assertion in someone's
    // Postman run is worse than an absent one, so name the path that was left out.
    const { script, warnings } = render([
      { type: "jsonpath", path: "$.items[?(@.active)].id", exists: true },
      { type: "jsonpath", path: "$..name", exists: true },
    ]);
    expect(script).toBe("");
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("too complex to express as a Postman test");
    expect(warnings[0]).toContain("$.items[?(@.active)].id");
  });

  it("warns that a schema assertion needs the spec Postman does not carry", () => {
    const { script, warnings } = render([{ type: "schema" }]);
    expect(script).toBe("");
    expect(warnings[0]).toContain("no Postman equivalent");
  });

  it("names each test the way TruSpec names the assertion", () => {
    const { script } = render([{ type: "status", equals: 200 }, { type: "duration", ltMs: 50 }]);
    expect(script).toContain('pm.test("status is 200"');
    expect(script).toContain('pm.test("responds under 50ms"');
  });

  it("emits nothing for an empty list, so a request without assertions gets no test block", () => {
    expect(render([]).script).toBe("");
  });

  it("escapes a value that would otherwise break out of the generated JavaScript", () => {
    const { script } = render([{ type: "body", contains: '");alert(1);//' }]);
    expect(script).toContain('pm.expect(pm.response.text()).to.include("\\");alert(1);//");');
    // The injected text must not appear as live code.
    expect(script).not.toMatch(/^\s*alert\(1\);/m);
  });

  it("emits JavaScript that actually parses, for every assertion form at once", () => {
    // `new Function` compiles without running, so this is a real syntax check on the generated
    // script — the failure mode that would land in someone's Postman collection and only show up
    // when they pressed Send.
    const all: TruSpecAssertion[] = [
      { type: "status", equals: 200 },
      { type: "status", in: [200, 201], lt: 300, gte: 200 },
      { type: "header", name: "X-A", exists: true },
      { type: "header", name: "X-B", equals: 'a "quoted" value' },
      { type: "header", name: "X-C", matches: "\\d+" },
      { type: "body", equals: "line1\nline2", matches: "^line" },
      { type: "body", empty: true },
      { type: "duration", ltMs: 250 },
      { type: "jsonpath", path: "$.a.b[0]", exists: true, valueType: "string" },
      { type: "jsonpath", path: "$.n", gt: 1, gte: 1, lt: 9, lte: 9 },
      { type: "jsonpath", path: "$.s", equals: "x", notEquals: "y", oneOf: ["x", "z"], contains: "x" },
      { type: "jsonpath", path: "$.arr", length: 3, minLength: 1, maxLength: 5, empty: false },
      { type: "jsonpath", path: "$.nil", valueType: "null" },
    ];
    const { script, warnings } = render(all);
    expect(warnings).toEqual([]);
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain("pm.test(");
  });
});
