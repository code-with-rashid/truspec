import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { resolveRequest, runRequest } from "../src/runner";
import { runPath } from "../src/workspace";

/** Capture the body `fetch` was handed, so a FormData can be inspected part by part. */
function capturing(): { fetch: typeof fetch; bodies: unknown[]; headers: Array<Record<string, string>> } {
  const bodies: unknown[] = [];
  const headers: Array<Record<string, string>> = [];
  const fn = (async (_url: string, init?: RequestInit) => {
    bodies.push(init?.body);
    headers.push((init?.headers as Record<string, string>) ?? {});
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: fn, bodies, headers };
}

const req = (yaml: string) => parse.request.parse(yaml);

const TEXT_ONLY = req(`
name: Upload
method: POST
url: "https://api.test/upload"
body:
  type: multipart
  fields:
    title: "{{title}}"
    count: 3
assertions:
  - { type: status, equals: 200 }
`);

describe("multipart resolution", () => {
  it("resolves fields into parts and interpolates them", () => {
    const eff = resolveRequest(TEXT_ONLY, { vars: { title: "Rex" } });
    expect(eff.body).toBeUndefined();
    expect(eff.multipart).toEqual([
      { kind: "text", name: "title", value: "Rex" },
      { kind: "text", name: "count", value: "3" },
    ]);
  });

  it("never sets Content-Type, because the boundary is generated at send time", () => {
    const eff = resolveRequest(TEXT_ONLY, { vars: { title: "x" } });
    expect(Object.keys(eff.headers).map((k) => k.toLowerCase())).not.toContain("content-type");
  });

  it("reports an unresolved variable in a field like any other", () => {
    expect(resolveRequest(TEXT_ONLY, {}).missing).toEqual(["title"]);
  });

  it("carries filename and contentType through for file and typed-text parts", () => {
    const r = req(`
name: U
method: POST
url: "https://api.test/u"
body:
  type: multipart
  fields:
    photo: { file: "./rex.jpg", filename: "pet.jpg", contentType: "image/jpeg" }
    meta: { text: '{"a":1}', contentType: "application/json" }
`);
    expect(resolveRequest(r, {}).multipart).toEqual([
      { kind: "file", name: "photo", path: "./rex.jpg", filename: "pet.jpg", contentType: "image/jpeg" },
      { kind: "text", name: "meta", value: '{"a":1}', contentType: "application/json" },
    ]);
  });
});

describe("multipart sending", () => {
  it("sends a FormData with each field, and lets fetch set the boundary", async () => {
    const cap = capturing();
    const result = await runRequest(TEXT_ONLY, { fetch: cap.fetch, vars: { title: "Rex" } });
    expect(result.ok).toBe(true);
    const body = cap.bodies[0] as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("title")).toBe("Rex");
    expect(body.get("count")).toBe("3");
    expect(Object.keys(cap.headers[0]!).map((k) => k.toLowerCase())).not.toContain("content-type");
  });

  it("sends a typed text part as a blob so its media type survives", async () => {
    const cap = capturing();
    const r = req(`
name: U
method: POST
url: "https://api.test/u"
body:
  type: multipart
  fields:
    meta: { text: '{"a":1}', contentType: "application/json", filename: "meta.json" }
`);
    await runRequest(r, { fetch: cap.fetch });
    const part = (cap.bodies[0] as FormData).get("meta") as File;
    expect(part).toBeInstanceOf(Blob);
    expect(part.type).toBe("application/json");
    expect(await part.text()).toBe('{"a":1}');
  });

  it("fails with a clear message when a file part has no filesystem access", async () => {
    const cap = capturing();
    const r = req(`
name: U
method: POST
url: "https://api.test/u"
body:
  type: multipart
  fields:
    photo: { file: "./rex.jpg" }
`);
    const result = await runRequest(r, { fetch: cap.fetch });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no filesystem access/);
    expect(cap.bodies).toEqual([]); // nothing was sent
  });
});

describe("multipart file parts through a workspace run", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "truspec-multipart-"));
    mkdirSync(join(dir, "api"), { recursive: true });
    mkdirSync(join(dir, "environments"), { recursive: true });
    writeFileSync(join(dir, "api", "rex.txt"), "hello bytes");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const writeRequest = (fields: string): void =>
    writeFileSync(
      join(dir, "api", "upload.tspec.yaml"),
      `tspec: "0.1"\nname: Upload\nmethod: POST\nurl: "https://api.test/u"\nbody:\n  type: multipart\n  fields:\n${fields}\nassertions:\n  - { type: status, equals: 200 }\n`,
    );

  it("reads a file relative to the request and sends its bytes and name", async () => {
    writeRequest('    doc: { file: "./rex.txt" }');
    const cap = capturing();
    const result = await runPath(join(dir, "api"), { fetch: cap.fetch });
    expect(result.ok, JSON.stringify(result.results[0]?.error)).toBe(true);
    const part = (cap.bodies[0] as FormData).get("doc") as File;
    expect(await part.text()).toBe("hello bytes");
    expect(part.name).toBe("rex.txt");
  });

  it("uses an explicit filename and content type when given", async () => {
    writeRequest('    doc: { file: "./rex.txt", filename: "renamed.md", contentType: "text/markdown" }');
    const cap = capturing();
    await runPath(join(dir, "api"), { fetch: cap.fetch });
    const part = (cap.bodies[0] as FormData).get("doc") as File;
    expect(part.name).toBe("renamed.md");
    expect(part.type).toBe("text/markdown");
  });

  it("fails with a readable error for a missing file", async () => {
    writeRequest('    doc: { file: "./nope.txt" }');
    const result = await runPath(join(dir, "api"), { fetch: capturing().fetch });
    expect(result.ok).toBe(false);
    expect(result.results[0]!.error).toMatch(/file not found: \.\/nope\.txt/);
  });

  it("refuses to read outside the workspace, so a collection cannot exfiltrate a file", async () => {
    writeFileSync(join(tmpdir(), "truspec-outside-secret.txt"), "do not send me");
    writeRequest('    doc: { file: "../../truspec-outside-secret.txt" }');
    const cap = capturing();
    const result = await runPath(join(dir, "api"), { fetch: cap.fetch });
    expect(result.ok).toBe(false);
    expect(result.results[0]!.error).toMatch(/Multipart body/);
    expect(cap.bodies).toEqual([]);
  });
});
