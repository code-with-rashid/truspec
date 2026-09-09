import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contractCommand } from "../src/commands/contract";
import { coverageCommand } from "../src/commands/coverage";
import { driftCommand } from "../src/commands/drift";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const spec = "examples/petstore/openapi.yaml";

/** A fetch stub returning a fixed JSON response, ignoring the request. */
function jsonFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function capture() {
  let out = "";
  let err = "";
  return {
    stdout: (s: string) => {
      out += s;
    },
    stderr: (s: string) => {
      err += s;
    },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

describe("truspec drift", () => {
  it("detects drift and exits 1", async () => {
    const cap = capture();
    const code = await driftCommand(["examples/petstore", "--spec", spec], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
    expect(cap.out).toMatch(/GET \/pets/);
    expect(cap.out).toMatch(/Drift detected/);
  });

  it("emits json", async () => {
    const cap = capture();
    const code = await driftCommand(["examples/petstore", "--spec", spec, "--json"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
    expect(JSON.parse(cap.out).added).toContain("GET /pets");
  });

  it("requires --spec (exit 2)", async () => {
    const cap = capture();
    const code = await driftCommand([], { cwd: repoRoot, stdout: cap.stdout, stderr: cap.stderr });
    expect(code).toBe(2);
    expect(cap.err).toMatch(/Usage/);
  });
});

describe("truspec coverage", () => {
  it("reports coverage and exits 0 (report-only)", async () => {
    const cap = capture();
    const code = await coverageCommand(["examples/petstore", "--spec", spec], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out).toMatch(/33%/);
  });

  it("fails the --min gate (exit 1)", async () => {
    const cap = capture();
    const code = await coverageCommand(["examples/petstore", "--spec", spec, "--min", "80"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
  });
});

describe("truspec contract", () => {
  const base = { cwd: repoRoot, processEnv: { token: "testtoken" }, now: () => 0 };

  it("passes when responses conform to the spec (exit 0)", async () => {
    const cap = capture();
    const code = await contractCommand(["examples/petstore", "--spec", spec, "--env", "local"], {
      ...base,
      fetch: jsonFetch(200, { id: 1, name: "Rex" }),
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out).toMatch(/GET \/pets\/\{id\}/);
    expect(cap.out).toMatch(/conform/);
  });

  it("fails on a contract violation (exit 1)", async () => {
    const cap = capture();
    const code = await contractCommand(["examples/petstore", "--spec", spec, "--env", "local", "--json"], {
      ...base,
      fetch: jsonFetch(200, { id: "bad" }),
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
    const report = JSON.parse(cap.out);
    expect(report.ok).toBe(false);
    expect(report.violations[0].op).toBe("GET /pets/{id}");
  });

  it("requires --spec (exit 2)", async () => {
    const cap = capture();
    const code = await contractCommand(["examples/petstore"], {
      cwd: repoRoot,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(2);
    expect(cap.err).toMatch(/Usage/);
  });
});

describe("truspec drift names the file behind each entry", () => {
  it("prints the request file for a stale reference and a changed one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "truspec-drift-src-"));
    try {
      mkdirSync(join(dir, "api"), { recursive: true });
      writeFileSync(
        join(dir, "openapi.yaml"),
        [
          "openapi: 3.0.3",
          'info: { title: S, version: "1" }',
          "paths:",
          "  /products:",
          "    get:",
          "      operationId: listProducts",
          "      parameters: [ { name: limit, in: query, required: true, schema: { type: integer } } ]",
          '      responses: { "200": { description: ok } }',
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(dir, "api", "list.tspec.yaml"),
        'tspec: "0.1"\nname: List\nmethod: GET\nurl: "http://x/products"\nspec: { operation: "GET /products" }\nassertions: []\n',
      );
      writeFileSync(
        join(dir, "api", "legacy.tspec.yaml"),
        'tspec: "0.1"\nname: Legacy\nmethod: GET\nurl: "http://x/search"\nspec: { operation: "GET /search" }\nassertions: []\n',
      );

      const cap = capture();
      const code = await driftCommand(["--spec", "openapi.yaml", "api"], {
        cwd: dir,
        stdout: cap.stdout,
        stderr: cap.stderr,
      });
      expect(code).toBe(1);
      expect(cap.out).toContain("- GET /search  (api/legacy.tspec.yaml)");
      expect(cap.out).toContain("missing required query param 'limit'  (api/list.tspec.yaml)");
      // An operation the spec has and the collection does not has no file to name.
      expect(cap.out).not.toMatch(/\+ .*\.tspec\.yaml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
