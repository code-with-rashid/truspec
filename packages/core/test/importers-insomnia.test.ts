import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { importInsomnia } from "../src/importers";

interface Res {
  _id: string;
  _type: string;
  parentId?: string;
  name?: string;
  [k: string]: unknown;
}

const doc = (resources: Res[]): unknown => ({ _type: "export", __export_format: 4, resources });

const workspace: Res = { _id: "wrk_1", _type: "workspace", name: "My API" };

const request = (over: Partial<Res> = {}): Res => ({
  _id: "req_1",
  _type: "request",
  parentId: "wrk_1",
  name: "Get pet",
  method: "GET",
  url: "https://api.test/pets/1",
  headers: [],
  ...over,
});

/** Parse the single request an import produced. */
function only(resources: Res[]) {
  const r = importInsomnia(doc(resources));
  expect(r.files.length, r.warnings.join("; ")).toBe(1);
  return { req: parse.request.parse(r.files[0]!.content), warnings: r.warnings, path: r.files[0]!.path };
}

describe("importInsomnia", () => {
  it("imports a request with its method, URL and prose", () => {
    const { req, path } = only([workspace, request({ description: "Fetch a pet." })]);
    expect(req.method).toBe("GET");
    expect(req.url).toBe("https://api.test/pets/1");
    expect(req.docs).toBe("Fetch a pet.");
    expect(path).toBe("get-pet.tspec.yaml");
    expect(req.assertions).toEqual([{ type: "status", lt: 400 }]);
  });

  it("reassembles folders from parentId pointers, which the export stores flat", () => {
    const r = importInsomnia(
      doc([
        workspace,
        { _id: "grp_1", _type: "request_group", parentId: "wrk_1", name: "Pets" },
        { _id: "grp_2", _type: "request_group", parentId: "grp_1", name: "Admin" },
        request({ parentId: "grp_2" }),
      ]),
    );
    expect(r.files[0]!.path).toBe("pets/admin/get-pet.tspec.yaml");
    expect(r.stats).toEqual({ requests: 1, folders: 2 });
  });

  it("survives a parent cycle instead of walking it forever", () => {
    const r = importInsomnia(
      doc([
        { _id: "grp_1", _type: "request_group", parentId: "grp_2", name: "A" },
        { _id: "grp_2", _type: "request_group", parentId: "grp_1", name: "B" },
        request({ parentId: "grp_1" }),
      ]),
    );
    expect(r.files.length).toBe(1);
  });

  it("skips rows the user disabled, in headers and query params alike", () => {
    const { req } = only([
      workspace,
      request({
        headers: [
          { name: "Accept", value: "application/json" },
          { name: "X-Off", value: "no", disabled: true },
        ],
        parameters: [
          { name: "expand", value: "owner" },
          { name: "off", value: "no", disabled: true },
        ],
      }),
    ]);
    expect(req.headers).toEqual({ Accept: "application/json" });
    expect(req.query).toEqual({ expand: "owner" });
  });

  it("normalizes Insomnia's `{{ _.var }}` template syntax", () => {
    const { req } = only([workspace, request({ url: "{{ _.baseUrl }}/pets/{{ petId }}" })]);
    expect(req.url).toBe("{{baseUrl}}/pets/{{petId}}");
  });

  it("converts bearer, basic and apikey auth", () => {
    expect(only([workspace, request({ authentication: { type: "bearer", token: "t" } })]).req.auth).toEqual({
      type: "bearer",
      token: "t",
    });
    expect(
      only([workspace, request({ authentication: { type: "basic", username: "u", password: "p" } })]).req.auth,
    ).toEqual({ type: "basic", username: "u", password: "p" });
    expect(
      only([workspace, request({ authentication: { type: "apikey", key: "K", value: "v", addTo: "queryParams" } })])
        .req.auth,
    ).toEqual({ type: "apikey", name: "K", value: "v", in: "query" });
  });

  it("ignores auth the user disabled", () => {
    expect(
      only([workspace, request({ authentication: { type: "bearer", token: "t", disabled: true } })]).req.auth,
    ).toBeUndefined();
  });

  it("converts an unattended OAuth2 grant and refuses a browser-only one", () => {
    const { req } = only([
      workspace,
      request({
        authentication: {
          type: "oauth2",
          grantType: "client_credentials",
          accessTokenUrl: "https://auth.test/t",
          clientId: "cid",
          clientSecret: "sec",
        },
      }),
    ]);
    expect(req.auth).toMatchObject({ type: "oauth2", grant: "client_credentials", clientId: "cid" });

    const r = importInsomnia(
      doc([workspace, request({ authentication: { type: "oauth2", grantType: "authorization_code" } })]),
    );
    expect(parse.request.parse(r.files[0]!.content).auth).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/needs a browser and was not imported/);
  });

  it("warns about an auth type it does not support rather than guessing", () => {
    const r = importInsomnia(doc([workspace, request({ authentication: { type: "ntlm" } })]));
    expect(r.warnings.join(" ")).toMatch(/auth type "ntlm" is not supported/);
  });

  it("converts JSON, urlencoded, multipart (with files) and GraphQL bodies", () => {
    expect(
      only([workspace, request({ method: "POST", body: { mimeType: "application/json", text: '{"a":1}' } })]).req.body,
    ).toEqual({ type: "json", content: { a: 1 } });

    expect(
      only([
        workspace,
        request({
          method: "POST",
          body: {
            mimeType: "application/x-www-form-urlencoded",
            params: [{ name: "a", value: "1" }, { name: "off", value: "x", disabled: true }],
          },
        }),
      ]).req.body,
    ).toEqual({ type: "form", content: { a: "1" } });

    expect(
      only([
        workspace,
        request({
          method: "POST",
          body: {
            mimeType: "multipart/form-data",
            params: [
              { name: "title", value: "Rex" },
              { name: "photo", fileName: "./rex.jpg" },
            ],
          },
        }),
      ]).req.body,
    ).toEqual({ type: "multipart", fields: { title: "Rex", photo: { file: "./rex.jpg" } } });

    expect(
      only([
        workspace,
        request({
          method: "POST",
          body: { mimeType: "application/graphql", text: '{"query":"{ me { id } }","variables":{"a":1}}' },
        }),
      ]).req.body,
    ).toEqual({ type: "graphql", query: "{ me { id } }", variables: { a: 1 } });
  });

  it("drops a now-redundant Content-Type header when the body carries its own type", () => {
    const { req } = only([
      workspace,
      request({
        method: "POST",
        headers: [{ name: "Content-Type", value: "application/json" }],
        body: { mimeType: "application/json", text: '{"a":1}' },
      }),
    ]);
    expect(req.headers).toBeUndefined();
  });

  it("falls back to text when a declared-JSON body does not parse", () => {
    const r = importInsomnia(
      doc([workspace, request({ method: "POST", body: { mimeType: "application/json", text: "{oops" } })]),
    );
    expect(parse.request.parse(r.files[0]!.content).body).toEqual({ type: "text", content: "{oops" });
    expect(r.warnings.join(" ")).toMatch(/did not parse/);
  });

  it("skips a request with no URL, and reports it", () => {
    const r = importInsomnia(doc([workspace, request({ url: "" })]));
    expect(r.files).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/no URL/);
  });

  it("de-duplicates filenames within a folder but not across folders", () => {
    const r = importInsomnia(
      doc([
        workspace,
        { _id: "g1", _type: "request_group", parentId: "wrk_1", name: "A" },
        request({ _id: "r1", parentId: "wrk_1" }),
        request({ _id: "r2", parentId: "wrk_1" }),
        request({ _id: "r3", parentId: "g1" }),
      ]),
    );
    expect(r.files.map((f) => f.path).sort()).toEqual([
      "a/get-pet.tspec.yaml",
      "get-pet-2.tspec.yaml",
      "get-pet.tspec.yaml",
    ]);
  });

  it("produces a stable order regardless of the export's own ordering", () => {
    const a = importInsomnia(doc([workspace, request({ _id: "r1", name: "Zed" }), request({ _id: "r2", name: "Al" })]));
    const b = importInsomnia(doc([workspace, request({ _id: "r2", name: "Al" }), request({ _id: "r1", name: "Zed" })]));
    expect(a.files.map((f) => f.path)).toEqual(b.files.map((f) => f.path));
  });

  it("rejects a document that is not an Insomnia export", () => {
    expect(() => importInsomnia({ nope: true })).toThrow(/Not an Insomnia export/);
  });

  it("reports an export with no requests rather than returning silence", () => {
    expect(importInsomnia(doc([workspace])).warnings).toContain("No requests found in the Insomnia export");
  });

  it("always emits files that round-trip through the schema", () => {
    const r = importInsomnia(
      doc([
        workspace,
        request({
          method: "PATCH",
          headers: [{ name: "X", value: "y" }],
          parameters: [{ name: "q", value: "1" }],
          body: { mimeType: "application/json", text: '{"z":true}' },
          authentication: { type: "bearer", token: "t" },
        }),
      ]),
    );
    expect(() => parse.request.parse(r.files[0]!.content)).not.toThrow();
  });
});
