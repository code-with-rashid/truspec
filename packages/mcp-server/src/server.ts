import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as tools from "./tools";

export interface ServerContext {
  cwd?: string;
  fetch?: typeof globalThis.fetch;
}

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

/** Build the TruSpec MCP server with all tools registered against the core engine. */
export function createServer(ctx: ServerContext = {}): McpServer {
  const c: tools.ToolContext = { cwd: ctx.cwd ?? process.cwd(), fetch: ctx.fetch };
  const server = new McpServer({ name: "truspec", version: "0.0.0" });

  server.registerTool(
    "truspec_list_collections",
    {
      title: "List collections",
      description:
        "List TruSpec requests under a directory: name, method, url, linked OpenAPI operation, and assertion count.",
      inputSchema: { dir: z.string().default(".").describe("Directory to scan, relative to the workspace.") },
    },
    async ({ dir }) => json(tools.listCollections(c, dir)),
  );

  server.registerTool(
    "truspec_run_request",
    {
      title: "Run request",
      description: "Run a single .tspec.yaml request; returns status, timing, body, and assertion results.",
      inputSchema: {
        path: z.string().describe("Path to a .tspec.yaml file."),
        env: z.string().optional().describe("Environment name."),
      },
    },
    async ({ path, env }) => json(await tools.runRequestTool(c, path, env)),
  );

  server.registerTool(
    "truspec_run_collection",
    {
      title: "Run collection",
      description: "Run every request in a directory; returns aggregate pass/fail plus per-request assertions.",
      inputSchema: {
        dir: z.string().describe("Directory of requests."),
        env: z.string().optional().describe("Environment name."),
      },
    },
    async ({ dir, env }) => json(await tools.runCollectionTool(c, dir, env)),
  );

  server.registerTool(
    "truspec_create_request",
    {
      title: "Create request",
      description:
        "Create a .tspec.yaml request file. The request object is validated against the schema before writing.",
      inputSchema: {
        path: z.string().describe("Destination path."),
        request: z.record(z.string(), z.unknown()).describe("A TruSpec request object."),
      },
    },
    async ({ path, request }) => json(tools.createRequest(c, path, request)),
  );

  server.registerTool(
    "truspec_update_request",
    {
      title: "Update request",
      description: "Merge a partial patch into an existing request file; validated before writing.",
      inputSchema: {
        path: z.string(),
        patch: z.record(z.string(), z.unknown()).describe("Fields to merge into the request."),
      },
    },
    async ({ path, patch }) => json(tools.updateRequest(c, path, patch)),
  );

  server.registerTool(
    "truspec_drift",
    {
      title: "Drift",
      description:
        "Diff a collection against an OpenAPI spec; lists untracked (added) and stale (removed) operations.",
      inputSchema: { dir: z.string(), spec: z.string().describe("Path to the OpenAPI spec.") },
    },
    async ({ dir, spec }) => json(tools.driftTool(c, dir, spec)),
  );

  server.registerTool(
    "truspec_coverage",
    {
      title: "Coverage",
      description: "Report which OpenAPI operations are exercised by a request with assertions.",
      inputSchema: { dir: z.string(), spec: z.string(), min: z.number().optional() },
    },
    async ({ dir, spec, min }) => json(tools.coverageTool(c, dir, spec, min ?? 0)),
  );

  server.registerTool(
    "truspec_scaffold_from_spec",
    {
      title: "Scaffold from spec",
      description: "Generate a request stub for every operation in an OpenAPI spec (closes drift gaps).",
      inputSchema: {
        spec: z.string(),
        out: z.string().describe("Output directory."),
        baseUrlVar: z.string().optional().describe("Variable name used for the base URL (default baseUrl)."),
      },
    },
    async ({ spec, out, baseUrlVar }) => json(tools.scaffoldFromSpec(c, spec, out, baseUrlVar ?? "baseUrl")),
  );

  return server;
}
