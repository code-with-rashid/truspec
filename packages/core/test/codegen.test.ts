import { describe, expect, it } from "vitest";
import { CODEGEN_TARGETS, codegenTargetIds, generateCode, toHttpShape } from "../src/codegen";
import { parse } from "../src/format";

function req(yaml: string) {
  return parse.request.parse(yaml);
}

const GET = req(`
name: Get pet
method: GET
url: "https://api.example.com/pets/1"
headers:
  Accept: application/json
`);

const POST = req(`
name: Create pet
method: POST
url: "https://api.example.com/pets"
headers:
  X-Trace: abc
auth:
  type: bearer
  token: "{{token}}"
body:
  type: json
  content: { name: "Rex", tags: ["a", "b"], age: 3, good: true, owner: null }
`);

describe("codegen targets", () => {
  it("registers a unique id and a renderer for every target", () => {
    const ids = codegenTargetIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(17);
    for (const t of CODEGEN_TARGETS) {
      expect(t.label).toBeTruthy();
      expect(t.group).toBeTruthy();
      expect(t.syntax).toBeTruthy();
    }
  });

  it("renders every target for a GET and a POST without throwing or emitting placeholders", () => {
    for (const t of CODEGEN_TARGETS) {
      for (const r of [GET, POST]) {
        const { code } = generateCode(r, t.id);
        expect(code.length, t.id).toBeGreaterThan(10);
        expect(code, t.id).toContain("api.example.com");
        expect(code, t.id).not.toContain("undefined");
        expect(code, t.id).not.toContain("[object Object]");
      }
    }
  });

  it("carries the method into every snippet", () => {
    const del = req(`name: d\nmethod: DELETE\nurl: "https://x.test/a"`);
    for (const t of CODEGEN_TARGETS) {
      const { code } = generateCode(del, t.id);
      // Rust/axios lower-case the method name; everyone else keeps it upper-case.
      expect(code.toLowerCase(), t.id).toContain("delete");
    }
  });

  it("rejects an unknown target by name", () => {
    expect(() => generateCode(GET, "cobol")).toThrow(/Unknown code target "cobol"/);
  });
});

describe("codegen shape", () => {
  it("applies folder baseUrl, folder headers and auth the way the runner does", () => {
    const shape = toHttpShape(req(`name: r\nurl: "/pets"\nquery: { page: 2 }`), {
      folder: {
        tspec: "0.1",
        baseUrl: "https://api.example.com",
        headers: { "X-Team": "core" },
        auth: { type: "apikey", name: "key", value: "s3cret", in: "query" },
      },
    });
    expect(shape.url).toBe("https://api.example.com/pets?page=2&key=s3cret");
    expect(shape.headers["X-Team"]).toBe("core");
  });

  it("substitutes known variables and keeps unresolved ones as authored placeholders", () => {
    const r = req(`name: r\nurl: "{{baseUrl}}/pets/{{petId}}"`);
    const shape = toHttpShape(r, { vars: { baseUrl: "https://api.example.com" } });
    expect(shape.url).toBe("https://api.example.com/pets/{{petId}}");
  });

  it("keeps a JSON body structured and a form body as fields", () => {
    expect(toHttpShape(POST).body).toEqual({
      kind: "json",
      value: { name: "Rex", tags: ["a", "b"], age: 3, good: true, owner: null },
    });
    const form = req(`name: f\nmethod: POST\nurl: "https://x.test/f"\nbody:\n  type: form\n  content: { a: "1", b: "two" }`);
    expect(toHttpShape(form).body).toEqual({ kind: "form", fields: { a: "1", b: "two" } });
  });

  it("folds a graphql body into the { query, variables } JSON actually sent", () => {
    const gql = req(`
name: g
method: POST
url: "https://x.test/graphql"
body:
  type: graphql
  query: "query($id: ID!) { user(id: $id) { name } }"
  variables: { id: "{{userId}}" }
`);
    expect(toHttpShape(gql, { vars: { userId: "u1" } }).body).toEqual({
      kind: "json",
      value: { query: "query($id: ID!) { user(id: $id) { name } }", variables: { id: "u1" } },
    });
  });
});

describe("per-language rendering", () => {
  it("curl sends the bearer header and a raw JSON body", () => {
    const { code } = generateCode(POST, "curl", { vars: { token: "t0k" } });
    expect(code).toContain("curl -X POST 'https://api.example.com/pets'");
    expect(code).toContain("-H 'Authorization: Bearer t0k'");
    expect(code).toContain(`--data-raw '{`);
  });

  it("curl url-encodes each form field separately", () => {
    const form = req(`name: f\nmethod: POST\nurl: "https://x.test/f"\nbody:\n  type: form\n  content: { a: "x y" }`);
    expect(generateCode(form, "curl").code).toContain("--data-urlencode 'a=x y'");
  });

  it("python renders Python literals, not JSON ones", () => {
    const { code } = generateCode(POST, "python-requests");
    expect(code).toContain("import requests");
    expect(code).toContain('"good": True');
    expect(code).toContain('"owner": None');
    expect(code).toContain("json=payload");
    expect(code).not.toContain("true,");
  });

  it("httpie pipes a raw body in rather than using key=value shorthand", () => {
    const { code } = generateCode(POST, "httpie");
    expect(code.startsWith("echo '{")).toBe(true);
    expect(code).toContain("| http POST 'https://api.example.com/pets'");
  });

  it("C# puts Content-Type on the content, never on request.Headers", () => {
    const { code } = generateCode(POST, "csharp");
    expect(code).toContain('new StringContent(');
    expect(code).toContain('"application/json"');
    expect(code).not.toContain('request.Headers.Add("Content-Type"');
  });

  it("Go falls back to an interpreted string when the body contains a backtick", () => {
    const r = req(`name: t\nmethod: POST\nurl: "https://x.test/t"\nbody:\n  type: text\n  content: "a \`b\` c"`);
    const { code } = generateCode(r, "go");
    expect(code).toContain('strings.NewReader("a `b` c")');
  });

  it("Rust widens the raw-string hashes when the body contains a quote-hash sequence", () => {
    const r = req(`name: t\nmethod: POST\nurl: "https://x.test/t"\nbody:\n  type: text\n  content: 'say "#hi'`);
    const { code } = generateCode(r, "rust");
    expect(code).toContain('r##"say "#hi"##');
  });

  it("escapes quotes and newlines in every double-quoted language", () => {
    const r = req(`name: t\nmethod: POST\nurl: "https://x.test/t"\nbody:\n  type: text\n  content: "he said \\"hi\\"\\nbye"`);
    for (const id of ["javascript-fetch", "java", "csharp", "swift", "kotlin", "dart", "php"]) {
      const { code } = generateCode(r, id);
      expect(code, id).toContain('\\"hi\\"');
      expect(code, id).not.toMatch(/\n\s*bye/);
    }
    // Go uses a raw string literal, where a quote and a newline are already literal.
    expect(generateCode(r, "go").code).toContain('strings.NewReader(`he said "hi"');
  });

  it("shell quoting survives a single quote in the URL", () => {
    const r = req(`name: t\nurl: "https://x.test/it's"`);
    expect(generateCode(r, "curl").code).toContain(`'https://x.test/it'\\''s'`);
  });
});
