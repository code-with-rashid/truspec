import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { importHar } from "../src/importers";

interface EntryInput {
  method?: string;
  url: string;
  headers?: Array<{ name: string; value: string }>;
  postData?: { mimeType?: string; text?: string; params?: Array<{ name: string; value: string }> };
  status?: number;
}

const har = (entries: EntryInput[]): unknown => ({
  log: {
    version: "1.2",
    entries: entries.map((e) => ({
      request: {
        method: e.method ?? "GET",
        url: e.url,
        headers: e.headers ?? [],
        ...(e.postData ? { postData: e.postData } : {}),
      },
      response: { status: e.status ?? 200 },
    })),
  },
});

/** Parse the single request an import produced. */
function only(entries: EntryInput[], opts = {}) {
  const r = importHar(har(entries), opts);
  expect(r.files.length, r.warnings.join("; ")).toBe(1);
  return { req: parse.request.parse(r.files[0]!.content), warnings: r.warnings, path: r.files[0]!.path };
}

describe("importHar", () => {
  it("converts an entry into a request with its query params split out", () => {
    const { req } = only([{ url: "https://api.example.com/pets?expand=owner&page=2" }]);
    expect(req.method).toBe("GET");
    expect(req.url).toBe("https://api.example.com/pets");
    expect(req.query).toEqual({ expand: "owner", page: "2" });
  });

  it("asserts the status that was actually recorded", () => {
    expect(only([{ url: "https://x.test/a", status: 201 }]).req.assertions).toEqual([
      { type: "status", equals: 201 },
    ]);
    // A HAR with no usable status (a failed request) still yields a runnable assertion.
    expect(only([{ url: "https://x.test/a", status: 0 }]).req.assertions).toEqual([
      { type: "status", lt: 400 },
    ]);
  });

  it("strips browser noise headers but keeps the ones that matter", () => {
    const { req } = only([
      {
        url: "https://x.test/a",
        headers: [
          { name: "accept", value: "application/json" },
          { name: "user-agent", value: "Mozilla/5.0" },
          { name: "sec-ch-ua", value: '"Chromium"' },
          { name: ":authority", value: "x.test" },
          { name: "content-length", value: "12" },
          { name: "X-Trace", value: "abc" },
        ],
      },
    ]);
    expect(req.headers).toEqual({ accept: "application/json", "X-Trace": "abc" });
  });

  it("keeps the noise when explicitly asked to", () => {
    const { req } = only(
      [{ url: "https://x.test/a", headers: [{ name: "user-agent", value: "Mozilla/5.0" }] }],
      { keepNoiseHeaders: true },
    );
    expect(req.headers).toEqual({ "user-agent": "Mozilla/5.0" });
  });

  it("lifts a bearer Authorization header into structured auth", () => {
    const { req } = only([
      { url: "https://x.test/a", headers: [{ name: "authorization", value: "Bearer tok-1" }] },
    ]);
    expect(req.auth).toEqual({ type: "bearer", token: "tok-1" });
    expect(req.headers).toBeUndefined();
  });

  it("decodes a basic Authorization header", () => {
    const basic = Buffer.from("bob:pw").toString("base64");
    expect(
      only([{ url: "https://x.test/a", headers: [{ name: "authorization", value: `Basic ${basic}` }] }]).req.auth,
    ).toEqual({ type: "basic", username: "bob", password: "pw" });
  });

  it("imports a JSON body as JSON and drops the now-redundant content type", () => {
    const { req } = only([
      {
        method: "POST",
        url: "https://x.test/a",
        headers: [{ name: "content-type", value: "application/json" }],
        postData: { mimeType: "application/json", text: '{"name":"Rex"}' },
      },
    ]);
    expect(req.body).toEqual({ type: "json", content: { name: "Rex" } });
    expect(req.headers).toBeUndefined();
  });

  it("imports a urlencoded body from text or from params", () => {
    expect(
      only([
        {
          method: "POST",
          url: "https://x.test/a",
          postData: { mimeType: "application/x-www-form-urlencoded", text: "u=bob&p=pw" },
        },
      ]).req.body,
    ).toEqual({ type: "form", content: { u: "bob", p: "pw" } });

    expect(
      only([
        {
          method: "POST",
          url: "https://x.test/a",
          postData: {
            mimeType: "application/x-www-form-urlencoded",
            params: [
              { name: "u", value: "bob" },
              { name: "p", value: "pw" },
            ],
          },
        },
      ]).req.body,
    ).toEqual({ type: "form", content: { u: "bob", p: "pw" } });
  });

  it("imports a multipart entry's fields and says that file contents are not in a HAR", () => {
    const r = importHar(
      har([
        {
          method: "POST",
          url: "https://x.test/u",
          postData: { mimeType: "multipart/form-data", params: [{ name: "title", value: "Rex" }] },
        },
      ]),
    );
    expect(parse.request.parse(r.files[0]!.content).body).toEqual({
      type: "multipart",
      fields: { title: "Rex" },
    });
    expect(r.warnings.join(" ")).toMatch(/file contents are not stored in a HAR/);
  });

  it("falls back to a text body when a declared-JSON payload does not parse", () => {
    const r = importHar(
      har([{ method: "POST", url: "https://x.test/a", postData: { mimeType: "application/json", text: "{oops" } }]),
    );
    expect(parse.request.parse(r.files[0]!.content).body).toEqual({ type: "text", content: "{oops" });
    expect(r.warnings.join(" ")).toMatch(/did not parse/);
  });

  it("skips OPTIONS preflights by default and reports how many", () => {
    const r = importHar(har([{ method: "OPTIONS", url: "https://x.test/a" }, { url: "https://x.test/a" }]));
    expect(r.stats.requests).toBe(1);
    expect(r.warnings.join(" ")).toMatch(/Skipped 1 OPTIONS preflight/);

    expect(importHar(har([{ method: "OPTIONS", url: "https://x.test/a" }]), { includeOptions: true }).stats.requests).toBe(1);
  });

  it("filters by URL substring, case-insensitively", () => {
    const entries = [{ url: "https://api.x.test/pets" }, { url: "https://cdn.x.test/logo.png" }];
    expect(importHar(har(entries), { filter: "API.X" }).stats.requests).toBe(1);
  });

  it("replaces the recorded origin with a base-URL variable on request", () => {
    const { req } = only([{ url: "https://prod.example.com/pets/1" }], { baseUrlVar: "baseUrl" });
    expect(req.url).toBe("{{baseUrl}}/pets/1");
  });

  it("ignores non-HTTP entries such as data: and ws: URLs", () => {
    const r = importHar(har([{ url: "data:text/plain,hi" }, { url: "wss://x.test/socket" }]));
    expect(r.stats.requests).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/No importable entries/);
  });

  it("de-duplicates filenames for repeated calls to the same path", () => {
    const r = importHar(har([{ url: "https://x.test/pets" }, { url: "https://x.test/pets" }]));
    expect(r.stats.requests).toBe(2);
    expect(new Set(r.files.map((f) => f.path)).size).toBe(2);
  });

  it("reports a non-HAR document instead of throwing", () => {
    expect(importHar({ nope: true }).warnings).toEqual(["Not a HAR file: expected log.entries"]);
    expect(importHar(null).files).toEqual([]);
  });

  it("always emits files that round-trip through the schema", () => {
    const r = importHar(
      har([
        { method: "PATCH", url: "https://x.test/a?b=1", headers: [{ name: "X", value: "y" }], postData: { mimeType: "application/json", text: '{"z":true}' } },
      ]),
    );
    expect(() => parse.request.parse(r.files[0]!.content)).not.toThrow();
  });
});
