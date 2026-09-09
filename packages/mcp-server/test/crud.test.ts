import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "truspec-mcp-crud-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function connect(): Promise<Client> {
  const server = createServer({ cwd: dir });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text?: string }>;
  };
  return JSON.parse(res.content[0]?.text ?? "{}") as Record<string, unknown>;
}

const sample = 'tspec: "0.1"\nname: Get pet\nmethod: GET\nurl: "http://x/pets/1"\nheaders: { Accept: application/json, X-Trace: "1" }\nauth: { type: bearer, token: "t" }\nassertions: [ { type: status, equals: 200 } ]\n';

describe("MCP request CRUD", () => {
  it("reads a request as both a parsed object and its raw YAML", async () => {
    // Without this an agent could only patch safely by already knowing every field it wasn't
    // changing — which is to say, not safely.
    writeFileSync(join(dir, "get.tspec.yaml"), sample);
    const client = await connect();
    const r = await call(client, "truspec_read_request", { path: "get.tspec.yaml" });
    expect(r.ok).toBe(true);
    expect((r.request as { name: string }).name).toBe("Get pet");
    expect((r.request as { headers: Record<string, string> }).headers["X-Trace"]).toBe("1");
    expect(r.raw).toContain("tspec:");
    await client.close();
  });

  it("returns the schema error, and the raw text, for a file that does not parse", async () => {
    writeFileSync(join(dir, "bad.tspec.yaml"), 'tspec: "0.1"\nname: Bad\nmethod: GET\nurl: "http://x"\nheadrs: { a: b }\n');
    const client = await connect();
    const r = await call(client, "truspec_read_request", { path: "bad.tspec.yaml" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("did you mean 'headers'?");
    expect(r.raw).toContain("headrs"); // still readable, so the agent can fix it
    await client.close();
  });

  it("validates a draft without writing anything", async () => {
    const client = await connect();
    const good = await call(client, "truspec_validate_request", {
      request: { name: "X", method: "GET", url: "http://x", assertions: [] },
    });
    expect(good.ok).toBe(true);

    const bad = await call(client, "truspec_validate_request", {
      request: { name: "X", method: "GET", url: "http://x", assertions: [], headrs: { a: "b" } },
    });
    expect(bad.ok).toBe(false);
    // A correction, not a rejection.
    expect(bad.error).toContain("did you mean 'headers'?");
    await client.close();
  });

  it("removes a key when the patch sets it to null", async () => {
    // Otherwise a merge can never clear an optional field, and dropping `auth` would mean
    // deleting and recreating the file.
    writeFileSync(join(dir, "get.tspec.yaml"), sample);
    const client = await connect();
    const r = await call(client, "truspec_update_request", { path: "get.tspec.yaml", patch: { auth: null } });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "get.tspec.yaml"), "utf8")).not.toContain("bearer");
    await client.close();
  });

  it("deletes a request, and refuses a path that is not one", async () => {
    writeFileSync(join(dir, "get.tspec.yaml"), sample);
    writeFileSync(join(dir, "openapi.yaml"), "openapi: 3.0.3\n");
    const client = await connect();

    const refused = await call(client, "truspec_delete_request", { path: "openapi.yaml" });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/not a \.tspec\.yaml request/);
    expect(readFileSync(join(dir, "openapi.yaml"), "utf8")).toContain("openapi");

    const done = await call(client, "truspec_delete_request", { path: "get.tspec.yaml" });
    expect(done.ok).toBe(true);
    expect(await call(client, "truspec_read_request", { path: "get.tspec.yaml" })).toMatchObject({ ok: false });
    await client.close();
  });

  it("refuses to read or delete outside the workspace", async () => {
    const client = await connect();
    for (const name of ["truspec_read_request", "truspec_delete_request"]) {
      const res = (await client.callTool({ name, arguments: { path: "../escape.tspec.yaml" } })) as {
        isError?: boolean;
        content: Array<{ text?: string }>;
      };
      expect(res.isError, name).toBe(true);
      expect(res.content[0]?.text, name).toMatch(/escapes the workspace/);
    }
    await client.close();
  });

  it("serves the format reference generated from the schema that validates", async () => {
    const client = await connect();
    const r = await call(client, "truspec_format_reference", { kind: "request" });
    const schema = r.schema as { definitions?: Record<string, { properties?: Record<string, unknown> }> };
    const props = schema.definitions?.TruSpecRequest?.properties ?? {};
    // If this ever diverges from the validator, the reference is worse than none.
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["name", "method", "url", "assertions", "capture"]));
    expect(r.version).toBe("0.1");

    const env = await call(client, "truspec_format_reference", { kind: "environment" });
    expect(JSON.stringify(env.schema)).toContain("secrets");
    await client.close();
  });
});
