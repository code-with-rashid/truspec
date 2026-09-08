import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { importCurl, tokenizeShell } from "../src/importers";

/** Parse the single request an import produced. */
function only(text: string) {
  const r = importCurl(text);
  expect(r.files.length, r.warnings.join("; ")).toBe(1);
  return { req: parse.request.parse(r.files[0]!.content), warnings: r.warnings, path: r.files[0]!.path };
}

describe("tokenizeShell", () => {
  it("splits on whitespace and honors line continuations", () => {
    expect(tokenizeShell("curl -X GET \\\n  http://x.test/a").map((t) => t.value)).toEqual([
      "curl",
      "-X",
      "GET",
      "http://x.test/a",
    ]);
  });

  it("keeps a quoted run whole, including embedded spaces and the other quote style", () => {
    expect(tokenizeShell(`-H 'X: a b' -H "Y: it's"`).map((t) => t.value)).toEqual([
      "-H",
      "X: a b",
      "-H",
      "Y: it's",
    ]);
  });

  it("applies double-quote escapes but leaves a single-quoted backslash literal", () => {
    expect(tokenizeShell('"a\\"b"')[0]!.value).toBe('a"b');
    expect(tokenizeShell(`'a\\nb'`)[0]!.value).toBe("a\\nb");
  });

  it("decodes $'…' ANSI-C quoting", () => {
    expect(tokenizeShell("$'a\\nb'")[0]!.value).toBe("a\nb");
  });

  it("marks quoted tokens, so a header value containing `curl` cannot split the command", () => {
    const t = tokenizeShell(`curl -H 'X-Note: curl' http://x.test/a`);
    expect(t.filter((x) => x.value === "curl" && !x.quoted).length).toBe(1);
    const r = importCurl(`curl -H 'X-Note: curl inside' http://x.test/a`);
    expect(r.stats.requests).toBe(1);
  });
});

describe("importCurl", () => {
  it("imports a plain GET with headers and query params", () => {
    const { req } = only(`curl 'https://api.example.com/pets?expand=owner' -H 'Accept: application/json'`);
    expect(req.method).toBe("GET");
    expect(req.url).toBe("https://api.example.com/pets");
    expect(req.query).toEqual({ expand: "owner" });
    expect(req.headers).toEqual({ Accept: "application/json" });
    expect(req.assertions).toEqual([{ type: "status", lt: 400 }]);
  });

  it("infers POST from a body when no -X is given, and parses a JSON body", () => {
    const { req } = only(
      `curl https://api.example.com/pets -H 'Content-Type: application/json' -d '{"name":"Rex","age":3}'`,
    );
    expect(req.method).toBe("POST");
    expect(req.body).toEqual({ type: "json", content: { name: "Rex", age: 3 } });
    // The content type is implied by body.type; keeping the header too would duplicate it.
    expect(req.headers).toBeUndefined();
  });

  it("lifts a bearer Authorization header into structured auth", () => {
    const { req } = only(`curl https://x.test/a -H 'Authorization: Bearer abc123'`);
    expect(req.auth).toEqual({ type: "bearer", token: "abc123" });
    expect(req.headers).toBeUndefined();
  });

  it("decodes a basic Authorization header and -u into structured auth", () => {
    const basic = Buffer.from("bob:s3cret").toString("base64");
    expect(only(`curl https://x.test/a -H 'Authorization: Basic ${basic}'`).req.auth).toEqual({
      type: "basic",
      username: "bob",
      password: "s3cret",
    });
    expect(only(`curl https://x.test/a -u bob:s3cret`).req.auth).toEqual({
      type: "basic",
      username: "bob",
      password: "s3cret",
    });
  });

  it("keeps an unrecognized Authorization scheme as a plain header", () => {
    const { req } = only(`curl https://x.test/a -H 'Authorization: Negotiate abc'`);
    expect(req.auth).toBeUndefined();
    expect(req.headers).toEqual({ Authorization: "Negotiate abc" });
  });

  it("imports a urlencoded body as a form", () => {
    const { req } = only(
      `curl https://x.test/login -H 'content-type: application/x-www-form-urlencoded' -d 'user=bob&pw=hunter2'`,
    );
    expect(req.body).toEqual({ type: "form", content: { user: "bob", pw: "hunter2" } });
  });

  it("joins repeated -d flags the way curl does", () => {
    const { req } = only(`curl https://x.test/a -d 'a=1' -d 'b=2'`);
    expect(req.body).toEqual({ type: "text", content: "a=1&b=2" });
  });

  it("moves -G data into the query string instead of the body", () => {
    const { req } = only(`curl -G https://x.test/search -d 'q=cats' --data-urlencode 'lang=en'`);
    expect(req.method).toBe("GET");
    expect(req.body).toBeUndefined();
    expect(req.query).toEqual({ q: "cats", lang: "en" });
  });

  it("maps -I to HEAD and --json to a JSON body", () => {
    expect(only(`curl -I https://x.test/a`).req.method).toBe("HEAD");
    const { req } = only(`curl https://x.test/a --json '{"a":1}'`);
    expect(req.body).toEqual({ type: "json", content: { a: 1 } });
  });

  it("maps -A, -e and -b onto their headers", () => {
    const { req } = only(`curl https://x.test/a -A 'tsp/1' -e 'https://ref.test' -b 'sid=1'`);
    expect(req.headers).toEqual({ "User-Agent": "tsp/1", Referer: "https://ref.test", Cookie: "sid=1" });
  });

  it("reads combined short flags with an attached value", () => {
    const { req } = only(`curl -XPUT -H'Accept: text/plain' https://x.test/a`);
    expect(req.method).toBe("PUT");
    expect(req.headers).toEqual({ Accept: "text/plain" });
  });

  it("imports -F as a real multipart body, including file parts and their modifiers", () => {
    const { req } = only(
      `curl https://x.test/u -F 'title=Rex' -F 'photo=@./rex.jpg;type=image/jpeg;filename=pet.jpg'`,
    );
    expect(req.body).toEqual({
      type: "multipart",
      fields: {
        title: "Rex",
        photo: { file: "./rex.jpg", filename: "pet.jpg", contentType: "image/jpeg" },
      },
    });
  });

  it("still warns about -k, which has no request-file equivalent", () => {
    const r = importCurl(`curl -k https://x.test/u -F 'a=1'`);
    expect(r.files.length).toBe(1);
    expect(r.warnings.join(" ")).toMatch(/TLS/);
  });

  it("ignores flags that do not affect the request, without swallowing the URL", () => {
    const { req } = only(`curl -sSL --compressed -o out.json https://x.test/a`);
    expect(req.url).toBe("https://x.test/a");
  });

  it("imports several commands at once and de-duplicates their filenames", () => {
    const r = importCurl(`curl https://x.test/pets\ncurl -X POST https://x.test/pets -d '{}'`);
    expect(r.stats.requests).toBe(2);
    expect(new Set(r.files.map((f) => f.path)).size).toBe(2);
  });

  it("names a request from its method and URL tail", () => {
    expect(only(`curl https://x.test/v1/pets/42`).req.name).toBe("GET pets 42");
  });

  it("reports no-curl input as a warning rather than throwing", () => {
    const r = importCurl("just some text");
    expect(r.files).toEqual([]);
    expect(r.warnings).toContain("No curl command found");
  });

  it("always emits a file that round-trips through the schema", () => {
    const r = importCurl(`curl -X PATCH 'https://x.test/a?b=1' -H 'X: y' -d '{"z":true}'`);
    expect(r.files.length).toBe(1);
    expect(() => parse.request.parse(r.files[0]!.content)).not.toThrow();
  });
});
