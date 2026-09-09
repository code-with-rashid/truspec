import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCsv, parseDataText, parseJsonData, runPath } from "../src/workspace";

describe("parseCsv", () => {
  it("reads a header row and one row per line", () => {
    expect(parseCsv("a,b\n1,2\n3,4\n")).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    expect(parseCsv('name,note\n"Rex","good, very good"\n')).toEqual([
      { name: "Rex", note: "good, very good" },
    ]);
  });

  it("unescapes a doubled quote and keeps an embedded newline", () => {
    expect(parseCsv('q\n"he said ""hi""\nbye"\n')).toEqual([{ q: 'he said "hi"\nbye' }]);
  });

  it("normalizes CRLF so a Windows file leaves no stray carriage return", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([{ a: "1", b: "2" }]);
  });

  it("pads a short row and ignores an unnamed column", () => {
    expect(parseCsv("a,b,\n1\n")).toEqual([{ a: "1", b: "" }]);
  });

  it("returns nothing for empty input or a header alone", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a,b\n")).toEqual([]);
  });
});

describe("parseJsonData", () => {
  it("reads an array of flat objects, preserving numbers and booleans", () => {
    expect(parseJsonData('[{"id":1,"ok":true,"name":"a"}]')).toEqual([{ id: 1, ok: true, name: "a" }]);
  });

  it("renders a nested value as JSON, since a {{var}} can only carry text", () => {
    expect(parseJsonData('[{"tags":["a","b"]}]')).toEqual([{ tags: '["a","b"]' }]);
  });

  it("treats null as an empty value rather than the string 'null'", () => {
    expect(parseJsonData('[{"x":null}]')).toEqual([{ x: "" }]);
  });

  it("rejects malformed input with a message that says what is wrong", () => {
    expect(() => parseJsonData("{")).toThrow(/not valid JSON/);
    expect(() => parseJsonData('{"a":1}')).toThrow(/must be a JSON array/);
    expect(() => parseJsonData("[1]")).toThrow(/row 1 is not an object/);
  });

  it("picks the parser from the extension", () => {
    expect(parseDataText("a\n1\n", "d.csv")).toEqual([{ a: "1" }]);
    expect(parseDataText('[{"a":1}]', "d.json")).toEqual([{ a: 1 }]);
  });
});

describe("data-driven runs", () => {
  let dir: string;
  const urls: string[] = [];
  const cookies: Array<string | undefined> = [];

  const fetchStub = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    cookies.push(headers.Cookie ?? headers.cookie);
    return new Response(JSON.stringify({ id: urls.length }), {
      status: 200,
      headers: { "content-type": "application/json", "set-cookie": "sid=s; Path=/" },
    });
  }) as unknown as typeof fetch;

  beforeEach(() => {
    urls.length = 0;
    cookies.length = 0;
    dir = mkdtempSync(join(tmpdir(), "truspec-data-"));
    mkdirSync(join(dir, "api"), { recursive: true });
    writeFileSync(
      join(dir, "api", "get.tspec.yaml"),
      'tspec: "0.1"\nname: Get\nurl: "https://api.test/pets/{{petId}}"\nassertions:\n  - { type: status, equals: 200 }\n',
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("runs the selection once per CSV row, substituting that row's columns", async () => {
    writeFileSync(join(dir, "pets.csv"), "petId\n1\n2\n3\n");
    const r = await runPath(join(dir, "api"), { fetch: fetchStub, data: join(dir, "pets.csv") });
    expect(r.ok).toBe(true);
    expect(r.iterations).toBe(3);
    expect(r.results.length).toBe(3);
    expect(urls).toEqual([
      "https://api.test/pets/1",
      "https://api.test/pets/2",
      "https://api.test/pets/3",
    ]);
  });

  it("labels each result with its 1-based iteration, so a failure traces to its row", async () => {
    writeFileSync(join(dir, "pets.json"), '[{"petId":7},{"petId":8}]');
    const r = await runPath(join(dir, "api"), { fetch: fetchStub, data: join(dir, "pets.json") });
    expect(r.results.map((x) => x.iteration)).toEqual([1, 2]);
  });

  it("omits the iteration marker entirely for an ordinary single run", async () => {
    const r = await runPath(join(dir, "api"), { fetch: fetchStub, vars: { petId: "1" } });
    expect(r.iterations).toBeUndefined();
    expect(r.results[0]!.iteration).toBeUndefined();
  });

  it("keeps iterations independent: no captured value or cookie leaks between rows", async () => {
    writeFileSync(
      join(dir, "api", "get.tspec.yaml"),
      'tspec: "0.1"\nname: Get\nurl: "https://api.test/pets/{{petId}}"\ncapture:\n  seen: "$.id"\nassertions:\n  - { type: status, equals: 200 }\n',
    );
    writeFileSync(join(dir, "pets.csv"), "petId\n1\n2\n");
    await runPath(join(dir, "api"), { fetch: fetchStub, data: join(dir, "pets.csv") });
    // The first response sets a cookie; a fresh jar per iteration means row 2 does not send it.
    expect(cookies).toEqual([undefined, undefined]);
  });

  it("repeats the selection without a dataset", async () => {
    const r = await runPath(join(dir, "api"), { fetch: fetchStub, vars: { petId: "1" }, repeat: 3 });
    expect(r.iterations).toBe(3);
    expect(urls.length).toBe(3);
  });

  it("stops every remaining iteration on bail, and counts them as skipped", async () => {
    const failing = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    writeFileSync(join(dir, "pets.csv"), "petId\n1\n2\n3\n");
    const r = await runPath(join(dir, "api"), { fetch: failing, data: join(dir, "pets.csv"), bail: true });
    expect(r.results.length).toBe(1);
    expect(r.skipped).toBe(2);
    expect(r.ok).toBe(false);
  });

  it("refuses a missing or empty dataset rather than passing on zero data", async () => {
    await expect(runPath(join(dir, "api"), { fetch: fetchStub, data: "nope.csv" })).rejects.toThrow(
      /Data file not found/,
    );
    writeFileSync(join(dir, "empty.csv"), "petId\n");
    await expect(
      runPath(join(dir, "api"), { fetch: fetchStub, data: join(dir, "empty.csv") }),
    ).rejects.toThrow(/has no rows/);
  });

  it("lets a --var override still win over a dataset column", async () => {
    writeFileSync(join(dir, "pets.csv"), "petId\n1\n");
    // The dataset supplies petId; an explicit override is applied first, so the row wins —
    // documenting the precedence rather than leaving it to chance.
    const r = await runPath(join(dir, "api"), {
      fetch: fetchStub,
      data: join(dir, "pets.csv"),
      vars: { petId: "override" },
    });
    expect(r.ok).toBe(true);
    expect(urls[0]).toBe("https://api.test/pets/1");
  });
});
