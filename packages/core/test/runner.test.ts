import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import {
  deepEqual,
  evaluateAssertion,
  interpolate,
  interpolateDeep,
  jsonpath,
  resolveRequest,
  runRequest,
} from "../src/runner";

describe("interpolate", () => {
  it("replaces variables", () => {
    expect(interpolate("{{a}}/x/{{b}}", { a: "1", b: 2 }).value).toBe("1/x/2");
  });
  it("reports missing variables", () => {
    const r = interpolate("{{a}}-{{missing}}", { a: "1" });
    expect(r.value).toBe("1-");
    expect(r.missing).toEqual(["missing"]);
  });
  it("interpolates deeply", () => {
    const r = interpolateDeep({ a: "{{x}}", b: ["{{y}}"] }, { x: "1", y: "2" });
    expect(r.value).toEqual({ a: "1", b: ["2"] });
  });
});

describe("jsonpath", () => {
  const data = { id: 1, items: [{ name: "a" }, { name: "b" }], nested: { deep: true } };
  it("reads members and indices", () => {
    expect(jsonpath(data, "$.id")).toEqual([1]);
    expect(jsonpath(data, "$.items[0].name")).toEqual(["a"]);
    expect(jsonpath(data, "$.items[-1].name")).toEqual(["b"]);
    expect(jsonpath(data, "$['nested']['deep']")).toEqual([true]);
  });
  it("supports wildcard", () => {
    expect(jsonpath(data, "$.items[*].name")).toEqual(["a", "b"]);
  });
  it("returns empty for missing", () => {
    expect(jsonpath(data, "$.nope")).toEqual([]);
  });
  it("throws on malformed path", () => {
    expect(() => jsonpath(data, "items")).toThrow();
  });
});

describe("deepEqual", () => {
  it("compares values", () => {
    expect(deepEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1], [1, 2])).toBe(false);
  });
});

describe("resolveRequest", () => {
  it("applies baseUrl, headers, bearer auth, and query", () => {
    const req = parse.request.parse('name: r\nmethod: GET\nurl: "/pets/{{id}}"\nquery: { expand: owner }');
    const eff = resolveRequest(req, {
      folder: parse.folderConfig.parse('baseUrl: "https://api.test"\nauth: { type: bearer, token: "{{tok}}" }'),
      vars: { id: "7", tok: "secret" },
    });
    expect(eff.url).toBe("https://api.test/pets/7?expand=owner");
    expect(eff.headers.Authorization).toBe("Bearer secret");
    expect(eff.missing).toEqual([]);
  });

  it("serializes a json body and sets content-type", () => {
    const req = parse.request.parse('name: r\nmethod: POST\nurl: http://x\nbody: { type: json, content: { a: "{{v}}" } }');
    const eff = resolveRequest(req, { vars: { v: "1" } });
    expect(eff.body).toBe('{"a":"1"}');
    expect(eff.headers["Content-Type"]).toBe("application/json");
  });

  it("places an apikey in the query when configured", () => {
    const req = parse.request.parse('name: r\nurl: http://x\nauth: { type: apikey, name: k, value: v, in: query }');
    const eff = resolveRequest(req, {});
    expect(eff.url).toBe("http://x?k=v");
  });

  it("reports missing variables", () => {
    const eff = resolveRequest(parse.request.parse("name: r\nurl: http://x/{{missing}}"), {});
    expect(eff.missing).toContain("missing");
  });
});

describe("evaluateAssertion", () => {
  const res = {
    status: 200,
    headers: { "content-type": "application/json" },
    bodyText: '{"id":1}',
    json: { id: 1 },
    durationMs: 50,
  };
  it("checks status", () => {
    expect(evaluateAssertion({ type: "status", equals: 200 }, res).ok).toBe(true);
    expect(evaluateAssertion({ type: "status", equals: 404 }, res).ok).toBe(false);
    expect(evaluateAssertion({ type: "status", in: [200, 201] }, res).ok).toBe(true);
  });
  it("checks jsonpath exists/equals", () => {
    expect(evaluateAssertion({ type: "jsonpath", path: "$.id", exists: true }, res).ok).toBe(true);
    expect(evaluateAssertion({ type: "jsonpath", path: "$.id", equals: 1 }, res).ok).toBe(true);
    expect(evaluateAssertion({ type: "jsonpath", path: "$.nope", exists: false }, res).ok).toBe(true);
  });
  it("checks header and duration", () => {
    expect(evaluateAssertion({ type: "header", name: "Content-Type", matches: "json" }, res).ok).toBe(true);
    expect(evaluateAssertion({ type: "duration", ltMs: 100 }, res).ok).toBe(true);
    expect(evaluateAssertion({ type: "duration", ltMs: 10 }, res).ok).toBe(false);
  });
});

describe("runRequest (injected fetch)", () => {
  it("runs and passes assertions", async () => {
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.test/pets/1");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer t");
      return new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const req = parse.request.parse(
      [
        "name: Get pet",
        'url: "{{baseUrl}}/pets/{{id}}"',
        "auth: { type: bearer, token: \"{{tok}}\" }",
        "assertions:",
        "  - { type: status, equals: 200 }",
        '  - { type: jsonpath, path: "$.id", equals: 1 }',
      ].join("\n"),
    );
    let t = 0;
    const result = await runRequest(req, {
      vars: { baseUrl: "https://api.test", id: "1", tok: "t" },
      fetch: fakeFetch,
      now: () => (t += 10),
    });
    expect(result.ok).toBe(true);
    expect(result.response?.status).toBe(200);
    expect(result.assertions.every((a) => a.ok)).toBe(true);
  });

  it("fails on unresolved variables without calling fetch", async () => {
    let called = false;
    const fakeFetch = (async () => {
      called = true;
      return new Response("");
    }) as typeof fetch;
    const result = await runRequest(parse.request.parse("name: r\nurl: http://x/{{missing}}"), {
      fetch: fakeFetch,
    });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
    expect(result.missingVars).toContain("missing");
  });

  it("reports assertion failures", async () => {
    const fakeFetch = (async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const result = await runRequest(
      parse.request.parse("name: r\nurl: http://x\nassertions:\n  - { type: status, equals: 201 }"),
      { fetch: fakeFetch },
    );
    expect(result.ok).toBe(false);
    expect(result.assertions[0]?.ok).toBe(false);
  });

  it("captures network errors", async () => {
    const fakeFetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const result = await runRequest(parse.request.parse("name: r\nurl: http://x"), { fetch: fakeFetch });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });
});
