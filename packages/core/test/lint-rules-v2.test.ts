import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintWorkspace, LINT_RULES } from "../src/lint";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-lint2-"));
  mkdirSync(join(dir, "environments"), { recursive: true });
  writeFileSync(join(dir, "environments", "local.env.yaml"), 'tspec: "0.1"\nname: local\nvariables: { baseUrl: "https://api.test" }\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, body: string): void => writeFileSync(join(dir, name), body);
const rules = (): string[] => lintWorkspace(dir).findings.map((f) => f.rule);
const find = (rule: string) => lintWorkspace(dir).findings.find((f) => f.rule === rule);

describe("body-on-bodiless-method", () => {
  const withBody = (method: string): string =>
    `tspec: "0.1"\nname: X\nmethod: ${method}\nurl: "{{baseUrl}}/x"\nbody: { type: json, content: { a: 1 } }\nassertions: [ { type: status, equals: 200 } ]\n`;

  it("is an error, because such a request can never be sent at all", () => {
    // `fetch` throws "Request with GET/HEAD method cannot have body" every single time.
    for (const method of ["GET", "HEAD"]) {
      write("a.tspec.yaml", withBody(method));
      const f = find("body-on-bodiless-method");
      expect(f?.severity, method).toBe("error");
      expect(f?.message, method).toContain("cannot have body");
    }
  });

  it("leaves methods that may carry a body alone", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      write("a.tspec.yaml", withBody(method));
      expect(rules(), method).not.toContain("body-on-bodiless-method");
    }
  });

  it("does not fire on `body: { type: none }`, which sends nothing", () => {
    write("a.tspec.yaml", 'tspec: "0.1"\nname: X\nmethod: GET\nurl: "{{baseUrl}}/x"\nbody: { type: none }\nassertions: [ { type: status, equals: 200 } ]\n');
    expect(rules()).not.toContain("body-on-bodiless-method");
  });
});

describe("content-type-conflict", () => {
  const post = (headers: string, body: string): string =>
    `tspec: "0.1"\nname: X\nmethod: POST\nurl: "{{baseUrl}}/x"\nheaders: ${headers}\nbody: ${body}\nassertions: [ { type: status, equals: 200 } ]\n`;

  it("catches a header that names a different format than the body", () => {
    // The explicit header wins in the resolver, so the request sends JSON bytes labelled as XML
    // and the server's 400 says nothing about why.
    write("a.tspec.yaml", post("{ Content-Type: application/xml }", "{ type: json, content: { a: 1 } }"));
    expect(find("content-type-conflict")?.message).toContain("body.type: json");
  });

  it("allows a more specific type of the same format — the reason the override exists", () => {
    write("a.tspec.yaml", post('{ Content-Type: "application/vnd.api+json" }', "{ type: json, content: { a: 1 } }"));
    expect(rules()).not.toContain("content-type-conflict");
    write("a.tspec.yaml", post('{ Content-Type: "application/json; charset=utf-8" }', "{ type: json, content: { a: 1 } }"));
    expect(rules()).not.toContain("content-type-conflict");
  });

  it("checks form and multipart bodies too, and matches the header case-insensitively", () => {
    write("a.tspec.yaml", post("{ content-type: application/json }", "{ type: form, content: { a: b } }"));
    expect(rules()).toContain("content-type-conflict");
    write("a.tspec.yaml", post("{ Content-Type: application/json }", "{ type: multipart, fields: { a: b } }"));
    expect(rules()).toContain("content-type-conflict");
  });

  it("says nothing about a text body, which carries no format of its own", () => {
    write("a.tspec.yaml", post("{ Content-Type: text/csv }", '{ type: text, content: "a,b" }'));
    expect(rules()).not.toContain("content-type-conflict");
  });
});

describe("capture-never-used", () => {
  it("flags a capture no later request reads — usually a half-applied rename", () => {
    write("01.tspec.yaml", 'tspec: "0.1"\nname: Login\nmethod: POST\nurl: "{{baseUrl}}/login"\norder: 1\ncapture: { authToken: "$.token" }\nassertions: [ { type: status, equals: 200 } ]\n');
    write("02.tspec.yaml", 'tspec: "0.1"\nname: Me\nmethod: GET\nurl: "{{baseUrl}}/me"\norder: 2\nauth: { type: bearer, token: "{{token}}" }\nassertions: [ { type: status, equals: 200 } ]\n');
    const report = lintWorkspace(dir);
    // Both halves of the same mistake are reported: the capture nobody reads, and the name nothing sets.
    expect(report.findings.find((f) => f.rule === "capture-never-used")?.message).toContain("capture.authToken");
    expect(report.findings.some((f) => f.rule === "undeclared-var")).toBe(true);
  });

  it("stays quiet when a later request uses the capture", () => {
    write("01.tspec.yaml", 'tspec: "0.1"\nname: Login\nmethod: POST\nurl: "{{baseUrl}}/login"\norder: 1\ncapture: { token: "$.token" }\nassertions: [ { type: status, equals: 200 } ]\n');
    write("02.tspec.yaml", 'tspec: "0.1"\nname: Me\nmethod: GET\nurl: "{{baseUrl}}/me"\norder: 2\nauth: { type: bearer, token: "{{token}}" }\nassertions: [ { type: status, equals: 200 } ]\n');
    expect(rules()).not.toContain("capture-never-used");
  });
});

describe("undeclared-var when the name IS captured, just too late", () => {
  it("names the file and says to fix the order, instead of claiming nothing captures it", () => {
    // The old message sent the reader looking for a capture that was right there.
    write("late.tspec.yaml", 'tspec: "0.1"\nname: Login\nmethod: POST\nurl: "{{baseUrl}}/login"\norder: 5\ncapture: { token: "$.token" }\nassertions: [ { type: status, equals: 200 } ]\n');
    write("early.tspec.yaml", 'tspec: "0.1"\nname: Me\nmethod: GET\nurl: "{{baseUrl}}/me"\norder: 1\nauth: { type: bearer, token: "{{token}}" }\nassertions: [ { type: status, equals: 200 } ]\n');
    const m = find("undeclared-var")?.message ?? "";
    expect(m).toContain("late.tspec.yaml");
    expect(m).toContain("runs later");
    expect(m).toContain("order");
  });
});

describe("rule registry", () => {
  it("lists every new rule, so `--list-rules` and the docs stay complete", () => {
    const ids = LINT_RULES.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["body-on-bodiless-method", "content-type-conflict", "capture-never-used"]));
  });

  it("honours --disable for each of them", () => {
    write("a.tspec.yaml", 'tspec: "0.1"\nname: X\nmethod: GET\nurl: "{{baseUrl}}/x"\nbody: { type: json, content: { a: 1 } }\nassertions: [ { type: status, equals: 200 } ]\n');
    const report = lintWorkspace(dir, { disable: ["body-on-bodiless-method"] });
    expect(report.findings.map((f) => f.rule)).not.toContain("body-on-bodiless-method");
    expect(report.ok).toBe(true); // the error is what made it not ok
  });
});

describe("script-runs-unsandboxed", () => {
  const withScript = (name: string, script: string): string =>
    `tspec: "0.1"\nname: ${name}\nmethod: GET\nurl: "{{baseUrl}}/x"\nscript: ${script}\nassertions: [ { type: status, equals: 200 } ]\n`;

  it("names which script a request carries", () => {
    // The point is reviewability after an import: a script has the same access as the process,
    // so a collection you did not write deserves a line telling you to look.
    write("pre.tspec.yaml", withScript("A", '{ pre: "tr.set(\'a\',1)" }'));
    const pre = find("script-runs-unsandboxed");
    expect(pre?.severity).toBe("warning");
    expect(pre?.message).toContain("script.pre runs");
    expect(pre?.message).toContain("same access as the truspec process");

    rmSync(join(dir, "pre.tspec.yaml"));
    write("post.tspec.yaml", withScript("B", '{ post: "tr.expect(true)" }'));
    expect(find("script-runs-unsandboxed")?.message).toContain("script.post runs");

    rmSync(join(dir, "post.tspec.yaml"));
    write("both.tspec.yaml", withScript("C", '{ pre: "tr.set(\'a\',1)", post: "tr.expect(true)" }'));
    expect(find("script-runs-unsandboxed")?.message).toContain("script.pre and script.post");
  });

  it("says nothing about a request with no script", () => {
    write("plain.tspec.yaml", `tspec: "0.1"\nname: D\nmethod: GET\nurl: "{{baseUrl}}/x"\nassertions: [ { type: status, equals: 200 } ]\n`);
    expect(rules()).not.toContain("script-runs-unsandboxed");
  });

  it("can be disabled like any other rule", () => {
    write("pre.tspec.yaml", withScript("A", '{ pre: "tr.set(\'a\',1)" }'));
    const report = lintWorkspace(dir, { disable: ["script-runs-unsandboxed"] });
    expect(report.findings.some((f) => f.rule === "script-runs-unsandboxed")).toBe(false);
  });

  it("is listed in LINT_RULES, so `--list-rules` and the docs can stay in step", () => {
    expect(LINT_RULES.some((r) => r.id === "script-runs-unsandboxed")).toBe(true);
  });
});

describe("inline-secret in environment files", () => {
  // Built at run time: a credential-shaped literal must never be a committed string.
  const fixture = (prefix: string, rest: string): string => prefix + rest;
  const writeEnv = (name: string, body: string): void =>
    writeFileSync(join(dir, "environments", name), body);

  it("flags a credential inlined as an environment variable", () => {
    // CLAUDE.md's hard rule names environment files alongside requests, but the linter only ever
    // read requests — and an env file is exactly where someone puts a value a {{var}} needs.
    writeEnv(
      "leaky.env.yaml",
      `tspec: "0.1"\nname: leaky\nvariables:\n  baseUrl: "https://api.test"\n  apiToken: "${fixture("sk", "_live_abcdefghijklmnopqrstuvwx")}"\n  awsKey: "${fixture("AKIA", "IOSFODNN7EXAMPLE")}"\n`,
    );
    const found = lintWorkspace(dir).findings.filter((f) => f.rule === "inline-secret");
    expect(found).toHaveLength(2);
    expect(found.every((f) => f.severity === "error")).toBe(true);
    expect(found.every((f) => f.path === "environments/leaky.env.yaml")).toBe(true);
    expect(found.map((f) => f.message).join(" ")).toContain("variables.apiToken");
    expect(found.map((f) => f.message).join(" ")).toContain("variables.awsKey");
    expect(found[0]?.message).toContain("secrets:");
  });

  it("says nothing about a well-formed environment", () => {
    // The default `local.env.yaml` from beforeEach plus a properly declared secret name.
    writeEnv("ok.env.yaml", 'tspec: "0.1"\nname: ok\nvariables: { baseUrl: "https://api.test" }\nsecrets: [ token ]\n');
    expect(lintWorkspace(dir).findings.some((f) => f.rule === "inline-secret")).toBe(false);
  });

  it("reports an environment file that does not parse, rather than skipping it", () => {
    writeEnv("broken.env.yaml", 'tspec: "0.1"\nname: broken\nvariables: { a: 1 }\nnope: true\n');
    const parseErrors = lintWorkspace(dir).findings.filter(
      (f) => f.rule === "parse" && f.path === "environments/broken.env.yaml",
    );
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0]?.severity).toBe("error");
  });
});
