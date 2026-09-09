import { describe, expect, it } from "vitest";
import { interpolateDeep } from "../src/runner/interpolate";
import { resolveRequest } from "../src/runner/resolve";
import { parse } from "../src/format";

const typed = <T>(input: T, vars: Record<string, string | number | boolean>) =>
  interpolateDeep(input, vars, { typed: true });

describe("typed interpolation in a JSON body", () => {
  it("keeps a number and a boolean when the value is exactly one template", () => {
    const { value } = typed({ qty: "{{qty}}", live: "{{live}}" }, { qty: 2, live: true });
    expect(value).toEqual({ qty: 2, live: true });
  });

  it("still produces a string as soon as anything is concatenated", () => {
    // Concatenation is a string operation; only a lone template can carry a type.
    const { value } = typed({ a: "id-{{qty}}", b: "{{qty}}{{qty}}", c: " {{qty}} " }, { qty: 2 });
    expect(value).toEqual({ a: "id-2", b: "22", c: " 2 " });
  });

  it("leaves a string variable exactly as it was", () => {
    expect(typed({ name: "{{name}}" }, { name: "Rex" }).value).toEqual({ name: "Rex" });
  });

  it("tolerates the whitespace the template syntax allows", () => {
    expect(typed({ q: "{{  qty  }}" }, { qty: 7 }).value).toEqual({ q: 7 });
  });

  it("reports a missing variable rather than substituting something", () => {
    const { value, missing } = typed({ q: "{{nope}}" }, {});
    expect(missing).toEqual(["nope"]);
    expect(value).toEqual({ q: "" });
  });

  it("keeps the placeholder for a missing variable under the `keep` policy", () => {
    const { value } = interpolateDeep({ q: "{{nope}}" }, {}, { typed: true, onMissing: "keep" });
    expect(value).toEqual({ q: "{{nope}}" });
  });

  it("does not resolve an inherited Object.prototype member", () => {
    // Same guard the string path has: `{{toString}}` is missing, not a function.
    const { value, missing } = typed({ q: "{{toString}}" }, {});
    expect(missing).toEqual(["toString"]);
    expect(value).toEqual({ q: "" });
  });

  it("works at depth, inside arrays and nested objects", () => {
    const { value } = typed({ rows: [{ n: "{{qty}}" }, { n: "{{qty}}" }] }, { qty: 3 });
    expect(value).toEqual({ rows: [{ n: 3 }, { n: 3 }] });
  });

  it("is off by default, so every other field still interpolates as text", () => {
    expect(interpolateDeep({ q: "{{qty}}" }, { qty: 2 }).value).toEqual({ q: "2" });
  });
});

describe("a resolved request sends the typed value", () => {
  const build = (bodyYaml: string) =>
    parse.request.parse(`tspec: "0.1"\nname: R\nmethod: POST\nurl: "http://x/y"\n${bodyYaml}`);

  it("puts a number in the JSON body, not a quoted one", () => {
    const req = build('body:\n  type: json\n  content: { qty: "{{qty}}", tag: "n-{{qty}}" }\n');
    const r = resolveRequest(req, { vars: { qty: 2 } });
    expect(r.body).toBe('{"qty":2,"tag":"n-2"}');
  });

  it("does the same for GraphQL variables, where a typed Int! is required", () => {
    const req = build('body:\n  type: graphql\n  query: "query($id: Int!) { a(id: $id) }"\n  variables: { id: "{{id}}" }\n');
    const r = resolveRequest(req, { vars: { id: 5 } });
    expect(JSON.parse(r.body ?? "{}").variables).toEqual({ id: 5 });
  });

  it("leaves a form body as strings, because form encoding has no types", () => {
    const req = build('body:\n  type: form\n  content: { qty: "{{qty}}" }\n');
    expect(resolveRequest(build('body:\n  type: form\n  content: { qty: "{{qty}}" }\n'), { vars: { qty: 2 } }).body).toBe("qty=2");
    expect(req.body?.type).toBe("form");
  });

  it("leaves the URL and headers as text", () => {
    const req = parse.request.parse(
      'tspec: "0.1"\nname: R\nmethod: GET\nurl: "http://x/{{id}}"\nheaders: { X-Id: "{{id}}" }\n',
    );
    const r = resolveRequest(req, { vars: { id: 7 } });
    expect(r.url).toBe("http://x/7");
    expect(r.headers["X-Id"]).toBe("7");
  });
});
