import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lineContaining, locator } from "../src/lint/locate";
import { lintWorkspace } from "../src/lint/index";

const YAML = `tspec: "0.1"
name: Bad
method: POST
url: "http://api.example.com/things"
headers:
  Content-Type: application/json
  X-Api-Key: "static"
body:
  type: json
  content:
    password: "hunter2"
    tags:
      - one
      - two
capture:
  id: "$.id"
`;

describe("locator", () => {
  const at = locator(YAML);

  it("resolves a top-level field to its line", () => {
    expect(at("name")).toBe(2);
    expect(at("url")).toBe(4);
  });

  it("resolves a nested field to its own line, not its parent's", () => {
    expect(at("headers")).toBe(6);
    expect(at("headers.X-Api-Key")).toBe(7);
    expect(at("body.content.password")).toBe(11);
    expect(at("capture.id")).toBe(16);
  });

  it("resolves an array index", () => {
    expect(at("body.content.tags[1]")).toBe(14);
  });

  it("falls back to the longest resolvable prefix rather than nowhere", () => {
    // `body.content.nope` does not exist; `body.content` does, and resolves to where that map
    // begins — inside the right structure rather than nowhere.
    expect(at("body.content.nope")).toBe(11);
    expect(at("headers.Missing.Deeper")).toBe(6);
  });

  it("treats a `url?param` suffix as addressing the url itself", () => {
    expect(at("url?api_key")).toBe(4);
  });

  it("returns undefined for a path with no resolvable prefix", () => {
    expect(at("nothingLikeThis")).toBeUndefined();
  });

  it("returns undefined for every path when the document does not parse", () => {
    const broken = locator("name: [unclosed\n  : :\n");
    expect(broken("name")).toBeUndefined();
  });

  it("locates lines correctly past the first (the offset search is not off by one)", () => {
    const long = Array.from({ length: 50 }, (_, i) => `k${i}: v${i}`).join("\n");
    const many = locator(long);
    expect(many("k0")).toBe(1);
    expect(many("k1")).toBe(2);
    expect(many("k49")).toBe(50);
  });
});

describe("lineContaining", () => {
  it("finds the first line holding the text", () => {
    expect(lineContaining(YAML, "X-Api-Key")).toBe(7);
  });

  it("is undefined when the text is absent", () => {
    expect(lineContaining(YAML, "{{nope}}")).toBeUndefined();
  });
});

describe("lint findings carry lines", () => {
  it("points each finding at the line it is about", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-lint-line-"));
    try {
      mkdirSync(join(dir, "api"), { recursive: true });
      writeFileSync(
        join(dir, "api", "bad.tspec.yaml"),
        `tspec: "0.1"
name: Bad
method: POST
url: "http://api.example.com/things"
headers:
  X-Api-Key: "${"AKIA"}IOSFODNN7EXAMPLE"
body:
  type: json
  content:
    ref: "{{missingVar}}"
capture:
  id: "$.["
assertions:
  - { type: status, equals: 200 }
`,
      );
      const report = lintWorkspace(dir, { processEnv: {} });
      const lineOf = (rule: string): number | undefined => report.findings.find((f) => f.rule === rule)?.line;
      expect(lineOf("inline-secret")).toBe(6);
      expect(lineOf("undeclared-var")).toBe(10);
      expect(lineOf("bad-jsonpath")).toBe(12);
      expect(lineOf("capture-never-used")).toBe(12);
      expect(lineOf("insecure-url")).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("omits the line for a finding about the file as a whole", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-lint-line-"));
    try {
      writeFileSync(join(dir, "a.tspec.yaml"), 'tspec: "0.1"\nname: A\nurl: "https://api.test/a"\n');
      const report = lintWorkspace(dir, { processEnv: {} });
      // `no-assertions` is about the request, and points at its name rather than at nothing.
      expect(report.findings.find((f) => f.rule === "no-assertions")?.line).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("gives a parse failure no line, since there is no document to locate in", () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-lint-line-"));
    try {
      writeFileSync(join(dir, "a.tspec.yaml"), "name: [unclosed\n  : :\n");
      const report = lintWorkspace(dir, { processEnv: {} });
      const parse = report.findings.find((f) => f.rule === "parse");
      expect(parse).toBeDefined();
      expect(parse?.line).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
