import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportPostman } from "../src/exporters";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-export-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(path: string, body: string): void {
  const full = join(dir, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}

/** The single item in an exported collection, for tests that write exactly one request. */
function onlyItem(): Record<string, unknown> {
  const r = exportPostman(dir);
  expect(r.stats.requests).toBe(1);
  return (r.collection.item as Record<string, unknown>[])[0]!;
}

const request = (extra: string): string =>
  ['tspec: "0.1"', "name: R", "method: POST", 'url: "https://api.test/x"', extra, ""].join("\n");

describe("exportPostman", () => {
  it("nests requests under folders, using folder.tspec.yaml's name when present", () => {
    write("api/folder.tspec.yaml", 'tspec: "0.1"\nname: Public API\n');
    write("api/a.tspec.yaml", 'tspec: "0.1"\nname: A\nurl: "https://x.test/a"\nassertions: []\n');
    write("api/deep/b.tspec.yaml", 'tspec: "0.1"\nname: B\nurl: "https://x.test/b"\nassertions: []\n');
    const r = exportPostman(dir, "My Collection");
    expect((r.collection.info as { name: string }).name).toBe("My Collection");
    expect(r.stats).toEqual({ requests: 2, folders: 2 });
    const api = (r.collection.item as Array<{ name: string; item: Array<{ name: string }> }>)[0]!;
    expect(api.name).toBe("Public API");
    expect(api.item.map((i) => i.name).sort()).toEqual(["A", "deep"]);
  });

  it("moves query parameters onto the URL, percent-encoded", () => {
    write("a.tspec.yaml", 'tspec: "0.1"\nname: A\nurl: "https://x.test/a"\nquery: { "q u": "a&b" }\nassertions: []\n');
    expect((onlyItem().request as { url: string }).url).toBe("https://x.test/a?q%20u=a%26b");
  });

  it("converts every auth scheme, including oauth2", () => {
    write("a.tspec.yaml", request("auth:\n  type: bearer\n  token: t\nassertions: []"));
    expect((onlyItem().request as { auth: { type: string } }).auth.type).toBe("bearer");

    rmSync(join(dir, "a.tspec.yaml"));
    write("b.tspec.yaml", request("auth:\n  type: basic\n  username: u\n  password: p\nassertions: []"));
    expect((onlyItem().request as { auth: { type: string } }).auth.type).toBe("basic");

    rmSync(join(dir, "b.tspec.yaml"));
    write("c.tspec.yaml", request("auth:\n  type: apikey\n  name: X-Key\n  value: v\nassertions: []"));
    expect((onlyItem().request as { auth: { type: string } }).auth.type).toBe("apikey");

    rmSync(join(dir, "c.tspec.yaml"));
    write("d.tspec.yaml", request("auth:\n  type: none\nassertions: []"));
    expect((onlyItem().request as { auth: { type: string } }).auth.type).toBe("noauth");

    rmSync(join(dir, "d.tspec.yaml"));
    write(
      "e.tspec.yaml",
      request('auth:\n  type: oauth2\n  tokenUrl: "https://auth.test/t"\n  clientId: cid\n  clientSecret: sec\n  scope: read\nassertions: []'),
    );
    const auth = (onlyItem().request as { auth: { type: string; oauth2: Array<{ key: string; value: string }> } }).auth;
    expect(auth.type).toBe("oauth2");
    const kv = Object.fromEntries(auth.oauth2.map((e) => [e.key, e.value]));
    expect(kv.grant_type).toBe("client_credentials");
    expect(kv.accessTokenUrl).toBe("https://auth.test/t");
    expect(kv.clientId).toBe("cid");
    expect(kv.client_authentication).toBe("body");
  });

  it("warns when an oauth2 field has no Postman equivalent instead of silently dropping it", () => {
    write(
      "a.tspec.yaml",
      request('auth:\n  type: oauth2\n  tokenUrl: "https://auth.test/t"\n  clientId: cid\n  audience: "https://api.test"\nassertions: []'),
    );
    const r = exportPostman(dir);
    expect(r.warnings.join(" ")).toMatch(/audience\/extra parameters have no Postman equivalent/);
  });

  it("converts every body type, including multipart", () => {
    write("a.tspec.yaml", request("body:\n  type: json\n  content: { a: 1 }\nassertions: []"));
    expect((onlyItem().request as { body: { mode: string } }).body.mode).toBe("raw");

    rmSync(join(dir, "a.tspec.yaml"));
    write("b.tspec.yaml", request('body:\n  type: form\n  content: { a: "1" }\nassertions: []'));
    expect((onlyItem().request as { body: { mode: string } }).body.mode).toBe("urlencoded");

    rmSync(join(dir, "b.tspec.yaml"));
    write("c.tspec.yaml", request('body:\n  type: graphql\n  query: "{ me { id } }"\nassertions: []'));
    expect((onlyItem().request as { body: { mode: string } }).body.mode).toBe("graphql");

    rmSync(join(dir, "c.tspec.yaml"));
    write("d.tspec.yaml", request('body:\n  type: text\n  content: "hi"\nassertions: []'));
    expect((onlyItem().request as { body: { raw: string } }).body.raw).toBe("hi");

    rmSync(join(dir, "d.tspec.yaml"));
    write(
      "e.tspec.yaml",
      request('body:\n  type: multipart\n  fields:\n    title: Rex\n    photo: { file: "./rex.jpg" }\nassertions: []'),
    );
    const body = (onlyItem().request as { body: { mode: string; formdata: Array<Record<string, string>> } }).body;
    // Before this, a multipart request exported with NO body at all.
    expect(body.mode).toBe("formdata");
    expect(body.formdata).toEqual([
      { key: "title", type: "text", value: "Rex" },
      { key: "photo", type: "file", src: "./rex.jpg" },
    ]);
  });

  it("carries scripts across as prerequest and test events", () => {
    write("a.tspec.yaml", request('script:\n  pre: "tr.set(\'a\', 1)"\n  post: "tr.expect(true)"\nassertions: []'));
    const events = onlyItem().event as Array<{ listen: string }>;
    expect(events.map((e) => e.listen)).toEqual(["prerequest", "test"]);
  });

  it("warns that transport options do not survive the trip", () => {
    write("a.tspec.yaml", request("options: { retries: 2 }\nassertions: []"));
    expect(exportPostman(dir).warnings.join(" ")).toMatch(/transport options .* no Postman equivalent/);
  });

  it("skips an unparseable file with a warning rather than failing the export", () => {
    write("good.tspec.yaml", 'tspec: "0.1"\nname: Good\nurl: "https://x.test/a"\nassertions: []\n');
    write("bad.tspec.yaml", "name: [unclosed\n");
    const r = exportPostman(dir);
    expect(r.stats.requests).toBe(1);
    expect(r.warnings.join(" ")).toMatch(/Skipped "bad.tspec.yaml"/);
  });

  it("produces a v2.1 collection with a schema url", () => {
    write("a.tspec.yaml", 'tspec: "0.1"\nname: A\nurl: "https://x.test/a"\nassertions: []\n');
    const info = exportPostman(dir).collection.info as { schema: string };
    expect(info.schema).toContain("v2.1.0");
  });
});
