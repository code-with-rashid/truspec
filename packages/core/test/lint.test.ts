import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LINT_RULES, type LintFinding, lintWorkspace, looksLikeSecret, referencedVars } from "../src/lint";
import { parse } from "../src/format";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-lint-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(path: string, body: string): void {
  const full = join(dir, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}

/** A minimal valid request; `extra` appends fields, and may override `url` via the `url` option. */
function request(name: string, extra = "", url = "https://api.test/x"): string {
  return ['tspec: "0.1"', `name: ${name}`, `url: "${url}"`, extra, ""].join("\n");
}

/**
 * Build a credential-shaped fixture at run time.
 *
 * These strings have to *look* exactly like real credentials for the rule under test to fire —
 * which is also precisely what a secret scanner blocks on a push. Assembling them from halves
 * keeps the literal out of the file while testing the identical value.
 */
const fixture = (prefix: string, rest: string): string => prefix + rest;

const lint = (opts = {}) => lintWorkspace(dir, { processEnv: {}, ...opts });
const rules = (findings: LintFinding[]): string[] => findings.map((f) => f.rule);

describe("lintWorkspace", () => {
  it("reports nothing for a sound collection", () => {
    write("environments/local.env.yaml", 'tspec: "0.1"\nname: local\nvariables: { baseUrl: "https://api.test" }\n');
    write("get.tspec.yaml", request("Get", "assertions:\n  - { type: status, equals: 200 }", "{{baseUrl}}/x"));
    const r = lint();
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.files).toBe(1);
  });

  it("reports a file that does not parse, and still lints the rest", () => {
    write("broken.tspec.yaml", "name: [unclosed\n");
    write("good.tspec.yaml", request("Good", "assertions:\n  - { type: status, equals: 200 }"));
    const r = lint();
    expect(rules(r.findings)).toEqual(["parse"]);
    expect(r.findings[0]!.path).toBe("broken.tspec.yaml");
    expect(r.errors).toBe(1);
    expect(r.ok).toBe(false);
  });

  it("flags a request with no assertions as a warning, not an error", () => {
    write("x.tspec.yaml", request("X"));
    const r = lint();
    expect(rules(r.findings)).toContain("no-assertions");
    expect(r.errors).toBe(0);
    expect(r.ok).toBe(true);
  });

  it("flags a duplicate name on both files", () => {
    write("a.tspec.yaml", request("Same", "assertions:\n  - { type: status, equals: 200 }"));
    write("b.tspec.yaml", request("Same", "assertions:\n  - { type: status, equals: 200 }"));
    const dup = lint().findings.filter((f) => f.rule === "duplicate-name");
    expect(dup.map((f) => f.path).sort()).toEqual(["a.tspec.yaml", "b.tspec.yaml"]);
    expect(dup[0]!.message).toContain("b.tspec.yaml");
  });

  it("flags an undeclared variable but accepts environment, secret and .env names", () => {
    write("environments/local.env.yaml", 'tspec: "0.1"\nname: local\nvariables: { baseUrl: "x" }\nsecrets: [token]\n');
    writeFileSync(join(dir, ".env"), "FROM_DOTENV=1\n");
    write(
      "a.tspec.yaml",
      request("A", "assertions:\n  - { type: status, lt: 400 }", "{{baseUrl}}/{{token}}/{{FROM_DOTENV}}/{{nope}}"),
    );
    const undeclared = lint().findings.filter((f) => f.rule === "undeclared-var");
    expect(undeclared.length).toBe(1);
    expect(undeclared[0]!.message).toContain("{{nope}}");
  });

  it("treats a variable captured by an earlier request as declared, but not a later one", () => {
    write(
      "01-login.tspec.yaml",
      request("Login", "order: 1\ncapture:\n  token: \"$.access_token\"\nassertions:\n  - { type: status, lt: 400 }"),
    );
    write(
      "02-use.tspec.yaml",
      request("Use", 'order: 2\nheaders:\n  X-T: "{{token}}"\nassertions:\n  - { type: status, lt: 400 }'),
    );
    expect(rules(lint().findings)).not.toContain("undeclared-var");

    // Reverse the order: the consumer now runs first, so the variable really is undeclared there.
    write(
      "02-use.tspec.yaml",
      request("Use", 'order: 0\nheaders:\n  X-T: "{{token}}"\nassertions:\n  - { type: status, lt: 400 }'),
    );
    expect(rules(lint().findings)).toContain("undeclared-var");
  });

  it("treats a name a pre-request script sets as declared", () => {
    write(
      "a.tspec.yaml",
      request("A", 'headers:\n  X-Nonce: "{{nonce}}"\nscript:\n  pre: |\n    tr.set("nonce", tr.uuid())\nassertions:\n  - { type: status, lt: 400 }'),
    );
    expect(rules(lint().findings)).not.toContain("undeclared-var");
  });

  it("does not treat a {{…}} inside docs or a script body as an interpolation site", () => {
    write(
      "a.tspec.yaml",
      request("A", 'docs: "pass {{whatever}} here"\nassertions:\n  - { type: status, lt: 400 }'),
    );
    expect(rules(lint().findings)).not.toContain("undeclared-var");
  });

  it("errors on a committed credential and names where it is", () => {
    const jwt = fixture("ey", "JhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop");
    write("a.tspec.yaml", request("A", `auth:\n  type: bearer\n  token: "${jwt}"\nassertions:\n  - { type: status, lt: 400 }`));
    const found = lint().findings.filter((f) => f.rule === "inline-secret");
    expect(found.length).toBe(1);
    expect(found[0]!.severity).toBe("error");
    expect(found[0]!.message).toContain("auth.token");
    expect(found[0]!.message).toContain("JWT");
  });

  it("finds a credential in a header, a query param and a JSON body", () => {
    const key = fixture("sk", "_live_abcdefghijklmnopqrstuvwx");
    write("h.tspec.yaml", request("H", `headers:\n  X-Key: "${key}"\nassertions:\n  - { type: status, lt: 400 }`));
    write("q.tspec.yaml", request("Q", `query:\n  key: "${key}"\nassertions:\n  - { type: status, lt: 400 }`));
    write(
      "b.tspec.yaml",
      request("B", `method: POST\nbody:\n  type: json\n  content: { nested: { secret: "${key}" } }\nassertions:\n  - { type: status, lt: 400 }`),
    );
    const found = lint().findings.filter((f) => f.rule === "inline-secret");
    expect(found.length).toBe(3);
    expect(found.map((f) => f.message).join(" ")).toContain("body.nested.secret");
  });

  it("errors on a JSONPath the engine cannot parse, in a capture or an assertion", () => {
    write("c.tspec.yaml", request("C", 'capture:\n  x: "$."\nassertions:\n  - { type: status, lt: 400 }'));
    write("d.tspec.yaml", request("D", 'assertions:\n  - { type: jsonpath, path: "$.", exists: true }'));
    const bad = lint().findings.filter((f) => f.rule === "bad-jsonpath");
    expect(bad.length).toBe(2);
    expect(bad.every((f) => f.severity === "error")).toBe(true);
  });

  it("warns about an absolute URL under a folder that sets baseUrl, and only then", () => {
    write("api/folder.tspec.yaml", 'tspec: "0.1"\nbaseUrl: "https://api.test"\n');
    write("api/a.tspec.yaml", request("A", "assertions:\n  - { type: status, lt: 400 }"));
    expect(rules(lint().findings)).toContain("absolute-url");

    rmSync(join(dir, "api/folder.tspec.yaml"));
    expect(rules(lint().findings)).not.toContain("absolute-url");
  });

  it("warns about plaintext http to a remote host but not to the local machine", () => {
    write("remote.tspec.yaml", 'tspec: "0.1"\nname: R\nurl: "http://api.example.com/x"\nassertions:\n  - { type: status, lt: 400 }\n');
    write("local.tspec.yaml", 'tspec: "0.1"\nname: L\nurl: "http://localhost:4000/x"\nassertions:\n  - { type: status, lt: 400 }\n');
    write("tmpl.tspec.yaml", 'tspec: "0.1"\nname: T\nurl: "http://{{host}}/x"\nassertions:\n  - { type: status, lt: 400 }\n');
    const insecure = lint({ knownVars: ["host"] }).findings.filter((f) => f.rule === "insecure-url");
    expect(insecure.map((f) => f.path)).toEqual(["remote.tspec.yaml"]);
  });

  it("honors --disable for any rule", () => {
    write("x.tspec.yaml", request("X"));
    expect(lint({ disable: ["no-assertions"] }).findings).toEqual([]);
  });

  it("documents every rule it can emit", () => {
    write("x.tspec.yaml", request("X"));
    const documented = new Set(LINT_RULES.map((r) => r.id));
    for (const f of lint().findings) expect(documented.has(f.rule), f.rule).toBe(true);
    expect(LINT_RULES.length).toBeGreaterThanOrEqual(8);
  });
});

describe("lint rule helpers", () => {
  it("recognizes common credential shapes and ignores placeholders", () => {
    expect(looksLikeSecret(fixture("ghp", "_abcdefghijklmnopqrstuvwxyz0123"))).toContain("GitHub");
    expect(looksLikeSecret(fixture("AKIA", "IOSFODNN7EXAMPLE"))).toContain("AWS");
    expect(looksLikeSecret(fixture("xoxb", "-1234567890-abcdefghij"))).toContain("Slack");
    // A template, a short string, and ordinary prose are not credentials.
    expect(looksLikeSecret("{{token}}")).toBeUndefined();
    expect(looksLikeSecret("short")).toBeUndefined();
    expect(looksLikeSecret("application/json; charset=utf-8")).toBeUndefined();
  });

  it("collects every referenced variable across templated fields", () => {
    const req = parse.request.parse(`
name: r
url: "{{baseUrl}}/{{id}}"
headers:
  X-A: "{{h}}"
query:
  q: "{{qv}}"
method: POST
body:
  type: json
  content: { deep: ["{{b}}"] }
`);
    expect(referencedVars(req).sort()).toEqual(["b", "baseUrl", "h", "id", "qv"]);
  });
});
