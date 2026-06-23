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
  it("treats Object.prototype names as missing, not inherited members", () => {
    // {{toString}} / {{constructor}} / {{__proto__}} must not resolve to native code.
    for (const name of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      const r = interpolate(`x/{{${name}}}/y`, { a: "1" });
      expect(r.value).toBe("x//y");
      expect(r.missing).toEqual([name]);
    }
  });
  it("interpolates deeply", () => {
    const r = interpolateDeep({ a: "{{x}}", b: ["{{y}}"] }, { x: "1", y: "2" });
    expect(r.value).toEqual({ a: "1", b: ["2"] });
  });

  it("breaks reference cycles instead of overflowing the stack", () => {
    const obj: Record<string, unknown> = { a: "{{x}}" };
    obj.self = obj;
    const r = interpolateDeep(obj, { x: "1" });
    expect((r.value as Record<string, unknown>).a).toBe("1");
    expect((r.value as Record<string, unknown>).self).toBeDefined();
  });

  it("throws a clear error on pathologically deep nesting (not a stack overflow)", () => {
    let node: Record<string, unknown> = { v: "{{x}}" };
    for (let i = 0; i < 300; i++) node = { a: node };
    expect(() => interpolateDeep(node, { x: "1" })).toThrow(/too deeply/);
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

  it("inserts query params before a URL fragment (params must reach the server, not the hash)", () => {
    const req = parse.request.parse('name: r\nmethod: GET\nurl: "http://x/search#section"\nquery: { q: hello }');
    const eff = resolveRequest(req, {});
    expect(eff.url).toBe("http://x/search?q=hello#section");
    // The WHATWG URL parser must see q in the search, not buried in the hash.
    const u = new URL(eff.url);
    expect(u.searchParams.get("q")).toBe("hello");
    expect(u.hash).toBe("#section");
  });

  it("appends to an existing query string before the fragment", () => {
    const req = parse.request.parse('name: r\nurl: "http://x/p?a=1#f"\nquery: { b: "2" }');
    const eff = resolveRequest(req, {});
    expect(eff.url).toBe("http://x/p?a=1&b=2#f");
    const u = new URL(eff.url);
    expect(u.searchParams.get("a")).toBe("1");
    expect(u.searchParams.get("b")).toBe("2");
  });

  it("places an apikey-in-query before a URL fragment (auth param must not be dropped)", () => {
    const req = parse.request.parse('name: r\nurl: "http://x/p#frag"\nauth: { type: apikey, name: k, value: secret, in: query }');
    const eff = resolveRequest(req, {});
    expect(eff.url).toBe("http://x/p?k=secret#frag");
    expect(new URL(eff.url).searchParams.get("k")).toBe("secret");
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

  it("does not auto-follow redirects — a 3xx is observable and assertable", async () => {
    // A spec-contract tool must report the ACTUAL response a URL returns; auto-following would report
    // the redirect target's 200 instead, making redirect responses impossible to test/validate.
    let sawRedirect: string | undefined;
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      sawRedirect = init?.redirect;
      return new Response("", { status: 302, headers: { location: "/final", "content-type": "text/plain" } });
    }) as typeof fetch;
    const req = parse.request.parse(
      [
        "name: r",
        "url: http://x/redirect",
        "assertions:",
        "  - { type: status, equals: 302 }",
        "  - { type: header, name: location, exists: true }",
      ].join("\n"),
    );
    const result = await runRequest(req, { fetch: fakeFetch });
    expect(sawRedirect).toBe("manual"); // runner must request the raw redirect, not follow it
    expect(result.response?.status).toBe(302);
    expect(result.ok).toBe(true); // both the status and Location assertions pass
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

  it("fails an invalid-regex assertion instead of throwing out of the run", async () => {
    const fakeFetch = (async () => new Response("body", { status: 200 })) as typeof fetch;
    const result = await runRequest(
      parse.request.parse('name: r\nurl: http://x\nassertions:\n  - { type: body, matches: "[" }'),
      { fetch: fakeFetch },
    );
    expect(result.ok).toBe(false);
    expect(result.assertions[0]?.ok).toBe(false);
    expect(result.assertions[0]?.message).toMatch(/assertion error|regular expression/i);
  });

  it("fails instead of OOMing when a response body exceeds the cap", async () => {
    const fakeFetch = (async () =>
      new Response("x".repeat(1024), { status: 200 })) as typeof fetch;
    const result = await runRequest(parse.request.parse("name: r\nurl: http://x"), {
      fetch: fakeFetch,
      maxResponseBytes: 64, // tiny cap; the 1 KB body must trip it
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exceeded/i);
    expect(result.response).toBeUndefined();
  });

  it("reads a normal body fully under the cap", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ id: 7 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const result = await runRequest(
      parse.request.parse('name: r\nurl: http://x\nassertions:\n  - { type: jsonpath, path: "$.id", equals: 7 }'),
      { fetch: fakeFetch },
    );
    expect(result.ok).toBe(true);
    expect(result.response?.bodyText).toBe('{"id":7}');
  });

  it("fails gracefully on a circular request body instead of crashing", async () => {
    const req = parse.request.parse("name: x\nurl: http://x\nbody: { type: json, content: { a: 1 } }");
    const content = (req.body as { content: Record<string, unknown> }).content;
    content.self = content; // inject a reference cycle
    const result = await runRequest(req, {
      fetch: (async () => new Response("{}", { status: 200 })) as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/resolve|circular/i);
  });
});
