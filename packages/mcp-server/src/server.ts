import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type MockServerHandle, startMockServer } from "@truspec/core/mock";
import { z } from "zod";
import * as tools from "./tools";

declare const __TRUSPEC_VERSION__: string | undefined;
const VERSION = typeof __TRUSPEC_VERSION__ === "string" ? __TRUSPEC_VERSION__ : "0.0.0";

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
  const server = new McpServer({ name: "truspec", version: VERSION });
  let mock: MockServerHandle | undefined;

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
        "Diff a collection against an OpenAPI spec: untracked (added), stale (removed), changed (missing required params), and — with `live` — operations missing from a running API.",
      inputSchema: {
        dir: z.string(),
        spec: z.string().describe("Path to the OpenAPI spec."),
        live: z.string().optional().describe("Base URL of a running API to probe (GET/HEAD only)."),
      },
    },
    async ({ dir, spec, live }) => json(await tools.driftTool(c, dir, spec, live)),
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
    "truspec_contract",
    {
      title: "Contract",
      description:
        "Run a collection and validate each response against its OpenAPI response schema. Reports per-operation conformance, violations (with the offending JSON paths), status-undocumented skips, and untested operations.",
      inputSchema: {
        dir: z.string(),
        spec: z.string().describe("Path to the OpenAPI spec."),
        env: z.string().optional().describe("Environment name."),
      },
    },
    async ({ dir, spec, env }) => json(await tools.contractTool(c, dir, spec, env)),
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

  server.registerTool(
    "truspec_mock_start",
    {
      title: "Start mock server",
      description: "Start a local mock server that serves generated responses from an OpenAPI spec.",
      inputSchema: {
        spec: z.string().describe("Path to the OpenAPI spec."),
        port: z.number().optional().describe("Port (default: an ephemeral free port)."),
        delay: z.number().optional().describe("Response delay in milliseconds."),
        validate: z.boolean().optional().describe("Validate requests against the spec (400 on mismatch)."),
      },
    },
    async ({ spec, port, delay, validate }) => {
      if (mock) return json({ alreadyRunning: true, url: mock.url, routes: mock.routes });
      const specText = readFileSync(resolve(c.cwd, spec), "utf8");
      mock = await startMockServer(specText, { port: port ?? 0, delayMs: delay, validate });
      return json({ started: true, url: mock.url, routes: mock.routes });
    },
  );

  server.registerTool(
    "truspec_mock_stop",
    { title: "Stop mock server", description: "Stop the running mock server, if any." },
    async () => {
      if (!mock) return json({ running: false });
      const url = mock.url;
      await mock.close();
      mock = undefined;
      return json({ stopped: true, url });
    },
  );

  return server;
}
