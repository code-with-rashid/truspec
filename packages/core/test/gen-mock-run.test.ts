import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startMockServer } from "../src/mock";
import { scaffoldFromSpec, writeScaffold } from "../src/spec";
import { runPath } from "../src/workspace";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const SPEC = `openapi: 3.0.3
info: { title: Shop, version: "1" }
paths:
  /products:
    get:
      operationId: listProducts
      parameters:
        - { name: limit, in: query, required: true, schema: { type: integer } }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: { type: array, items: { type: object, required: [id, name], properties: { id: { type: integer }, name: { type: string } } } }
    post:
      operationId: createProduct
      requestBody:
        required: true
        content:
          application/json:
            schema: { type: object, required: [name, priceCents], properties: { name: { type: string }, priceCents: { type: integer } } }
      responses:
        "201":
          description: created
          content:
            application/json:
              schema: { type: object, required: [id], properties: { id: { type: integer } } }
`;

/** Scaffold the spec into a fresh workspace and point an environment at `port`. */
function workspace(port: number): string {
  const dir = mkdtempSync(join(tmpdir(), "tspec-tri-"));
  dirs.push(dir);
  mkdirSync(join(dir, "environments"), { recursive: true });
  writeFileSync(
    join(dir, "environments", "local.env.yaml"),
    `tspec: "0.1"\nname: local\nvariables: { baseUrl: "http://127.0.0.1:${port}" }\n`,
  );
  writeScaffold(scaffoldFromSpec(SPEC).files, join(dir, "api"));
  return dir;
}

describe("scaffold, mock and runner agree on one spec", () => {
  it("a generated collection satisfies a mock that validates against the same spec", async () => {
    // Three components reading one OpenAPI document: the scaffolder deciding what to send, the
    // mock's request validator deciding what is acceptable, and the runner in between. If they
    // disagree, the first thing a spec-first user does — gen, then run against a mock — fails.
    const mock = await startMockServer(SPEC, { port: 0, validate: true });
    try {
      const dir = workspace(mock.port);
      const result = await runPath(join(dir, "api"), { env: "local", cwd: dir });
      expect(result.failed, JSON.stringify(result.results.map((r) => r.assertions), null, 1)).toBe(0);
      expect(result.passed).toBe(2);
      expect(result.ok).toBe(true);
    } finally {
      await mock.close();
    }
  });

  it("and the mock really is checking — stripping what the spec requires gets a 400", async () => {
    // Without this the test above could pass against a mock that validates nothing. Remove exactly
    // the required query parameter and required body the scaffolder emits, and both are rejected.
    const mock = await startMockServer(SPEC, { port: 0, validate: true });
    try {
      const dir = workspace(mock.port);
      for (const [file, drop] of [
        ["listproducts.tspec.yaml", /^query:\n(?: {2}.*\n)+/m],
        ["createproduct.tspec.yaml", /^body:\n(?: {2}.*\n)+/m],
      ] as const) {
        const p = join(dir, "api", file);
        writeFileSync(p, readFileSync(p, "utf8").replace(drop, ""));
      }
      const result = await runPath(join(dir, "api"), { env: "local", cwd: dir });
      expect(result.failed).toBe(2);
      for (const r of result.results) expect(r.response?.status).toBe(400);
    } finally {
      await mock.close();
    }
  });
});
