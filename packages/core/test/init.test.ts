import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { lintWorkspace } from "../src/lint";
import { scaffoldFromSpec } from "../src/spec";
import { initNextSteps, initProject } from "../src/workspace";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const blogSpec = readFileSync(join(repoRoot, "examples/blog/openapi.yaml"), "utf8");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-init-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("initProject", () => {
  it("scaffolds a runnable, lint-clean collection", () => {
    const r = initProject(dir);
    expect(r.created).toContain("api/folder.tspec.yaml");
    expect(r.created).toContain("api/health.tspec.yaml");
    expect(r.created).toContain("environments/local.env.yaml");
    expect(r.created).toContain(".env.example");
    expect(r.created).toContain(".gitignore");
    expect(r.skipped).toEqual([]);

    // The whole point is that the result is valid without further edits.
    expect(() => parse.request.parse(readFileSync(join(dir, "api/health.tspec.yaml"), "utf8"))).not.toThrow();
    expect(() => parse.folderConfig.parse(readFileSync(join(dir, "api/folder.tspec.yaml"), "utf8"))).not.toThrow();
    expect(lintWorkspace(dir, { processEnv: {} }).findings).toEqual([]);
  });

  it("gitignores .env so the first secret anyone adds is not committed", () => {
    initProject(dir);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain(".env");
  });

  it("appends to an existing .gitignore without disturbing it, and not twice", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules\n");
    initProject(dir);
    const after = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(after).toContain("node_modules");
    expect(after).toContain(".env");

    const second = initProject(dir);
    expect(second.skipped).toContain(".gitignore");
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(after);
  });

  it("is safe to re-run: existing files are reported, never clobbered", () => {
    initProject(dir);
    writeFileSync(join(dir, "api/health.tspec.yaml"), 'tspec: "0.1"\nname: Mine\nurl: "https://x.test"\n');
    const second = initProject(dir);
    expect(second.created).toEqual([]);
    expect(second.skipped).toContain("api/health.tspec.yaml");
    expect(readFileSync(join(dir, "api/health.tspec.yaml"), "utf8")).toContain("name: Mine");
  });

  it("overwrites only with force", () => {
    initProject(dir);
    writeFileSync(join(dir, "api/health.tspec.yaml"), "name: Mine\n");
    const forced = initProject(dir, { force: true });
    expect(forced.created).toContain("api/health.tspec.yaml");
    expect(readFileSync(join(dir, "api/health.tspec.yaml"), "utf8")).toContain("Health check");
    // .gitignore is the exception: it already ignores .env, and force must not append a
    // duplicate rule to a file the user also owns.
    expect(forced.skipped).toEqual([".gitignore"]);
  });

  it("honors a custom requests dir, environment name and base URL", () => {
    const r = initProject(dir, { requestsDir: "http", env: "staging", baseUrl: "https://staging.test" });
    expect(r.created).toContain("http/health.tspec.yaml");
    const env = parse.environment.parse(readFileSync(join(dir, "environments/staging.env.yaml"), "utf8"));
    expect(env.name).toBe("staging");
    expect(env.variables.baseUrl).toBe("https://staging.test");
  });

  it("scaffolds from a spec and seeds its path variables, so the first run resolves", () => {
    const r = initProject(dir, { specText: blogSpec });
    expect(r.created.some((f) => f.includes("getpost"))).toBe(true);
    expect(existsSync(join(dir, "api/health.tspec.yaml"))).toBe(false);

    const env = parse.environment.parse(readFileSync(join(dir, "environments/local.env.yaml"), "utf8"));
    // Without this the very first run fails with `Unresolved variables: {{id}}`.
    expect(env.variables.id).toBeDefined();
    expect(lintWorkspace(dir, { processEnv: {} }).findings).toEqual([]);
  });
});

describe("scaffoldFromSpec", () => {
  it("asserts the status the spec documents, not a blanket 200", () => {
    const scaffold = scaffoldFromSpec(blogSpec);
    const created = scaffold.files.find((f) => f.path.includes("createpost"));
    expect(created).toBeDefined();
    const req = parse.request.parse(created!.content);
    // The blog spec documents 201 for createPost; asserting 200 would fail on the first run.
    expect(req.assertions).toContainEqual({ type: "status", equals: 201 });
  });

  it("reports each path variable it introduces with a usable sample", () => {
    const scaffold = scaffoldFromSpec(blogSpec);
    expect(Object.keys(scaffold.pathVariables)).toContain("id");
    for (const sample of Object.values(scaffold.pathVariables)) expect(sample.length).toBeGreaterThan(0);
  });

  it("derives a sample from the parameter's own example, schema default, enum, or type", () => {
    const spec = `
openapi: 3.0.0
info: { title: t, version: "1" }
paths:
  /a/{withExample}: { get: { parameters: [ { name: withExample, in: path, required: true, example: 42 } ], responses: { "200": { description: ok } } } }
  /b/{withDefault}: { get: { parameters: [ { name: withDefault, in: path, required: true, schema: { type: string, default: "dflt" } } ], responses: { "200": { description: ok } } } }
  /c/{withEnum}: { get: { parameters: [ { name: withEnum, in: path, required: true, schema: { type: string, enum: [alpha, beta] } } ], responses: { "200": { description: ok } } } }
  /d/{anInt}: { get: { parameters: [ { name: anInt, in: path, required: true, schema: { type: integer } } ], responses: { "200": { description: ok } } } }
  /e/{aUuid}: { get: { parameters: [ { name: aUuid, in: path, required: true, schema: { type: string, format: uuid } } ], responses: { "200": { description: ok } } } }
  /f/{undocumented}: { get: { responses: { "200": { description: ok } } } }
`;
    expect(scaffoldFromSpec(spec).pathVariables).toEqual({
      withExample: "42",
      withDefault: "dflt",
      withEnum: "alpha",
      anInt: "1",
      aUuid: "00000000-0000-4000-8000-000000000000",
      undocumented: "example",
    });
  });
});

describe("initNextSteps", () => {
  it("points at the local mock when a spec was used, so the first run is green offline", () => {
    const r = initProject(dir, { specText: blogSpec });
    const steps = initNextSteps(r, { specPath: "openapi.yaml", cwd: dir }).join("\n");
    expect(steps).toContain("truspec mock --spec openapi.yaml");
    expect(steps).toContain("truspec run api --env local");
  });

  it("says plainly that the base URL needs pointing at a real API when there is no spec", () => {
    const r = initProject(dir);
    const steps = initNextSteps(r, { cwd: dir, baseUrl: "http://localhost:3000" }).join("\n");
    expect(steps).toContain("http://localhost:3000");
    expect(steps).toContain("truspec run api --env local");
  });

  it("prefixes a cd when the project was created somewhere else", () => {
    const r = initProject(dir);
    expect(initNextSteps(r, { cwd: tmpdir() })[0]).toMatch(/^cd /);
  });
});
