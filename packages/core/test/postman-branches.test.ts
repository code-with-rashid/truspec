import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { importPostman } from "../src/importers/postman";

const wrap = (request: unknown, extra: Record<string, unknown> = {}) => ({ item: [{ name: "R", request, ...extra }] });
const first = (input: object) => parse.request.parse(importPostman(input).files[0]?.content ?? "");

describe("postman importer — branch coverage", () => {
  it("auth: bearer / basic / apikey(header+query) / noauth / unsupported", () => {
    expect(first(wrap({ method: "GET", url: "http://x", auth: { type: "bearer", bearer: [{ key: "token", value: "T" }] } })).auth).toEqual({ type: "bearer", token: "T" });
    expect(first(wrap({ method: "GET", url: "http://x", auth: { type: "basic", basic: [{ key: "username", value: "u" }, { key: "password", value: "p" }] } })).auth).toEqual({ type: "basic", username: "u", password: "p" });
    expect(first(wrap({ method: "GET", url: "http://x", auth: { type: "apikey", apikey: [{ key: "key", value: "K" }, { key: "value", value: "V" }, { key: "in", value: "query" }] } })).auth).toMatchObject({ type: "apikey", name: "K", value: "V", in: "query" });
    expect(first(wrap({ method: "GET", url: "http://x", auth: { type: "apikey", apikey: [{ key: "key", value: "H" }, { key: "value", value: "V" }] } })).auth).toMatchObject({ in: "header" });
    expect(first(wrap({ method: "GET", url: "http://x", auth: { type: "noauth" } })).auth).toEqual({ type: "none" });
    const warned = importPostman(wrap({ method: "GET", url: "http://x", auth: { type: "oauth2" } }));
    expect(warned.warnings.some((w) => /not supported/.test(w))).toBe(true);
  });

  it("body: raw-json / raw-json-with-template→text / raw-text / urlencoded / formdata(file skipped) / graphql(string+object vars)", () => {
    expect(first(wrap({ method: "POST", url: "http://x", body: { mode: "raw", raw: '{"a":1}', options: { raw: { language: "json" } } } })).body).toEqual({ type: "json", content: { a: 1 } });
    expect(first(wrap({ method: "POST", url: "http://x", body: { mode: "raw", raw: "{{tpl}}", options: { raw: { language: "json" } } } })).body?.type).toBe("text");
    expect(first(wrap({ method: "POST", url: "http://x", body: { mode: "raw", raw: "plain" } })).body).toEqual({ type: "text", content: "plain" });
    expect(first(wrap({ method: "POST", url: "http://x", body: { mode: "urlencoded", urlencoded: [{ key: "a", value: "1" }, { key: "d", value: "x", disabled: true }] } })).body).toEqual({ type: "form", content: { a: "1" } });
    expect(first(wrap({ method: "POST", url: "http://x", body: { mode: "formdata", formdata: [{ key: "f", value: "v" }, { key: "file", type: "file" }] } })).body).toEqual({ type: "form", content: { f: "v" } });
    expect(first(wrap({ method: "POST", url: "http://x", body: { mode: "graphql", graphql: { query: "{a}", variables: '{"x":1}' } } })).body).toEqual({ type: "graphql", query: "{a}", variables: { x: 1 } });
    expect(first(wrap({ method: "POST", url: "http://x", body: { mode: "graphql", graphql: { query: "{a}", variables: { y: 2 } } } })).body).toEqual({ type: "graphql", query: "{a}", variables: { y: 2 } });
    expect(first(wrap({ method: "POST", url: "http://x", body: { mode: "graphql", graphql: { query: "{a}", variables: "{bad" } } })).body).toEqual({ type: "graphql", query: "{a}" });
    expect(first(wrap({ method: "POST", url: "http://x", body: { mode: "file" } })).body).toBeUndefined();
  });

  it("url: object with query array (disabled+nonstring) / raw with #-anchor / string shorthand", () => {
    const q = first(wrap({ method: "GET", url: { raw: "http://x?z=1", query: [{ key: "a", value: "1" }, { key: "b", value: "2", disabled: true }, { value: "noKey" }] } }));
    expect(q.query).toEqual({ a: "1" });
    // shorthand bare request string
    expect(first({ item: [{ name: "S", request: "GET https://api.test/x" }] }).url).toBe("https://api.test/x");
    expect(first({ item: [{ name: "S", request: "https://api.test/y" }] }).url).toBe("https://api.test/y");
  });

  it("headers: disabled + non-string key filtered; event scripts ported; method normalized", () => {
    const r = first(wrap({ method: "weird", url: "http://x", header: [{ key: "H", value: "v" }, { key: "D", value: "x", disabled: true }, { value: "noKey" }] }, { event: [{ listen: "prerequest", script: { exec: ["console.log(1)"] } }, { listen: "test", script: { exec: ["pm.test()"] } }] }));
    expect(r.headers).toEqual({ H: "v" });
    expect(r.method).toBe("GET"); // normalized from unsupported
    expect(r.script?.pre).toMatch(/Ported from Postman/);
    expect(r.script?.post).toMatch(/Ported from Postman/);
  });

  it("skips empty/urlless requests; nested folders + duplicate names + collection auth folder file", () => {
    const result = importPostman({
      info: { name: "C" },
      auth: { type: "bearer", bearer: [{ key: "token", value: "T" }] },
      item: [
        { name: "folder", item: [{ name: "dup", request: { method: "GET", url: "http://a" } }, { name: "dup", request: { method: "GET", url: "http://b" } }] },
        { name: "no url", request: { method: "GET", url: {} } },
        { name: "empty", request: "" },
        { request: { foo: 1 } },
      ],
    });
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain("folder.tspec.yaml"); // collection-level auth
    expect(paths).toContain("folder/dup.tspec.yaml");
    expect(paths).toContain("folder/dup-2.tspec.yaml"); // dedup
    expect(result.warnings.some((w) => /no URL|empty/.test(w))).toBe(true);
  });

  it("throws on a non-Postman document", () => {
    expect(() => importPostman({ not: "postman" })).toThrow(/Not a Postman/);
  });
});
