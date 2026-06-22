import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { runRequest } from "../src/runner";
import { parseOpenApi } from "../src/spec";
import { runPath } from "../src/workspace";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const petstoreDir = resolve(repoRoot, "examples", "petstore");
const specText = readFileSync(resolve(petstoreDir, "openapi.yaml"), "utf8");
const doc = parseYaml(specText) as Record<string, unknown>;
const getPet = parseOpenApi(specText).operations.find((o) => o.key === "GET /pets/{id}")!;

/** A fetch stub that always returns the given status/body, ignoring the request. */
function jsonFetch(status: number, body: unknown, contentType = "application/json"): typeof fetch {
  return (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": contentType },
    })) as unknown as typeof fetch;
}

const withSchemaAssertion = parse.request.parse(
  `name: get pet
method: GET
url: http://example.test/pets/1
assertions:
  - { type: schema }`,
);

const schemaOf = (r: { assertions: { type: string; ok: boolean; message: string }[] }) =>
  r.assertions.find((a) => a.type === "schema");

describe("schema assertion (runner)", () => {
  it("passes when the response matches the operation's response schema", async () => {
    const res = await runRequest(withSchemaAssertion, {
      fetch: jsonFetch(200, { id: 1, name: "Rex", tag: "good" }),
      contract: { doc, operation: getPet },
    });
    expect(schemaOf(res)?.ok).toBe(true);
    expect(schemaOf(res)?.message).toContain("conforms to GET /pets/{id}");
    expect(res.ok).toBe(true);
  });

  it("fails (with the violation path) when the response breaks the schema", async () => {
    const res = await runRequest(withSchemaAssertion, {
      fetch: jsonFetch(200, { id: "not-an-int", name: "Rex" }),
      contract: { doc, operation: getPet },
    });
    expect(schemaOf(res)?.ok).toBe(false);
    expect(schemaOf(res)?.message).toContain("/id");
    expect(res.ok).toBe(false);
  });

  it("skips (passes) when no spec is provided", async () => {
    const res = await runRequest(withSchemaAssertion, { fetch: jsonFetch(200, { anything: true }) });
    expect(schemaOf(res)?.ok).toBe(true);
    expect(schemaOf(res)?.message).toContain("no spec provided");
  });

  it("fails a required assertion when the status has no declared schema", async () => {
    const req = parse.request.parse(
      `name: x
method: GET
url: http://example.test/pets/1
assertions:
  - { type: schema, required: true }`,
    );
    const res = await runRequest(req, {
      fetch: jsonFetch(500, { error: "boom" }), // 500 is undocumented for GET /pets/{id}
      contract: { doc, operation: getPet },
    });
    expect(schemaOf(res)?.ok).toBe(false);
    expect(schemaOf(res)?.message).toContain("status 500");
  });

  it("skips a non-required assertion for an undocumented status", async () => {
    const res = await runRequest(withSchemaAssertion, {
      fetch: jsonFetch(500, { error: "boom" }),
      contract: { doc, operation: getPet },
    });
    expect(schemaOf(res)?.ok).toBe(true);
    expect(schemaOf(res)?.message).toContain("(skipped)");
  });

  it("fails when the body is not JSON", async () => {
    const res = await runRequest(withSchemaAssertion, {
      fetch: jsonFetch(200, "plain text", "text/plain"),
      contract: { doc, operation: getPet },
    });
    expect(schemaOf(res)?.ok).toBe(false);
    expect(schemaOf(res)?.message).toContain("not valid JSON");
  });

  it("auto-validates a spec-linked request with no explicit schema assertion", async () => {
    const req = parse.request.parse(
      `name: x
method: GET
url: http://example.test/pets/1
assertions:
  - { type: status, equals: 200 }`,
    );
    const res = await runRequest(req, {
      fetch: jsonFetch(200, { id: "bad" }),
      contract: { doc, operation: getPet, auto: true },
    });
    const schemaResults = res.assertions.filter((a) => a.type === "schema");
    expect(schemaResults).toHaveLength(1);
    expect(schemaResults[0]?.ok).toBe(false);
    expect(res.ok).toBe(false);
  });

  it("does not add a second schema check when one is already explicit (auto mode)", async () => {
    const res = await runRequest(withSchemaAssertion, {
      fetch: jsonFetch(200, { id: 1, name: "Rex" }),
      contract: { doc, operation: getPet, auto: true },
    });
    expect(res.assertions.filter((a) => a.type === "schema")).toHaveLength(1);
  });
});

describe("run --spec (workspace)", () => {
  const specPath = resolve(petstoreDir, "openapi.yaml");
  const env = { env: "local", spec: specPath, processEnv: { token: "testtoken" }, now: () => 0 } as const;

  it("auto-validates spec-linked requests and passes on a conforming response", async () => {
    const res = await runPath(petstoreDir, { ...env, fetch: jsonFetch(200, { id: 1, name: "Rex", tag: "good" }) });
    expect(res.ok).toBe(true);
    expect(schemaOf(res.results[0]!)?.ok).toBe(true);
  });

  it("fails the run when a spec-linked response violates the schema", async () => {
    const res = await runPath(petstoreDir, { ...env, fetch: jsonFetch(200, { id: "bad", name: 5 }) });
    expect(res.ok).toBe(false);
    expect(schemaOf(res.results[0]!)?.ok).toBe(false);
  });

  it("leaves runs without --spec unchanged (no schema row)", async () => {
    const res = await runPath(petstoreDir, {
      env: "local",
      processEnv: { token: "testtoken" },
      now: () => 0,
      fetch: jsonFetch(200, { id: 1, name: "Rex" }),
    });
    expect(res.results[0]?.assertions.some((a) => a.type === "schema")).toBe(false);
  });
});
