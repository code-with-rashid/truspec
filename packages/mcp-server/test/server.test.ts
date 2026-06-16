import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

async function connect(): Promise<Client> {
  const server = createServer({ cwd: repoRoot });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(res: unknown): string {
  const content = (res as { content: Array<{ type: string; text?: string }> }).content;
  return content[0]?.text ?? "";
}

describe("MCP server (in-memory client ↔ server)", () => {
  it("exposes the expected tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "truspec_list_collections",
        "truspec_run_request",
        "truspec_run_collection",
        "truspec_create_request",
        "truspec_update_request",
        "truspec_drift",
        "truspec_coverage",
        "truspec_scaffold_from_spec",
      ]),
    );
    await client.close();
  });

  it("runs truspec_drift over the protocol", async () => {
    const client = await connect();
    const res = await client.callTool({
      name: "truspec_drift",
      arguments: { dir: "examples/petstore", spec: "examples/petstore/openapi.yaml" },
    });
    const report = JSON.parse(textOf(res));
    expect(report.added).toContain("GET /pets");
    await client.close();
  });

  it("lists collections over the protocol", async () => {
    const client = await connect();
    const res = await client.callTool({
      name: "truspec_list_collections",
      arguments: { dir: "examples/petstore" },
    });
    expect(JSON.parse(textOf(res)).count).toBe(1);
    await client.close();
  });
});
