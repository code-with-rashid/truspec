import { readFileSync } from "node:fs";
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
    "truspec_read_request",
    {
      title: "Read request",
      description:
        "Read one .tspec.yaml request: the parsed object and the raw YAML. Read before patching — `truspec_update_request` merges one level deep, so patching a nested field like `headers` replaces it wholesale.",
      inputSchema: { path: z.string().describe("Path to a .tspec.yaml file.") },
    },
    async ({ path }) => json(tools.readRequest(c, path)),
  );

  server.registerTool(
    "truspec_validate_request",
    {
      title: "Validate request",
      description:
        "Check a request object against the schema without writing it. Errors name the key a typo was probably meant to be.",
      inputSchema: { request: z.record(z.string(), z.unknown()).describe("A TruSpec request object.") },
    },
    async ({ request }) => json(tools.validateRequest(request)),
  );

  server.registerTool(
    "truspec_delete_request",
    {
      title: "Delete request",
      description: "Delete a .tspec.yaml request file. Refuses any path that is not a request file.",
      inputSchema: { path: z.string().describe("Path to a .tspec.yaml file.") },
    },
    async ({ path }) => json(tools.deleteRequest(c, path)),
  );

  server.registerTool(
    "truspec_format_reference",
    {
      title: "Format reference",
      description:
        "The JSON Schema for a TruSpec file kind (request, folder or environment), generated from the schema that validates. Use it to author a valid file without guessing at the format.",
      inputSchema: {
        kind: z
          .enum(["request", "folder", "environment"])
          .default("request")
          .describe("Which file kind to describe."),
      },
    },
    async ({ kind }) => json(tools.formatReference(kind)),
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
      description:
        "Merge a partial patch into an existing request file, one level deep — a patched object field replaces the whole field, so read the request first. `null` removes a key. Validated before writing.",
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
      const specText = readFileSync(tools.workspacePath(c, spec), "utf8");
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

  server.registerTool(
    "truspec_environments",
    {
      title: "List or diff environments",
      description:
        "Describe the workspace's environments — variables, declared secrets, and whether each secret resolves — or diff two of them. Secret VALUES are never returned.",
      inputSchema: {
        dir: z.string().default(".").describe("Collection directory."),
        diff: z
          .array(z.string())
          .length(2)
          .optional()
          .describe("Two environment names to compare instead of listing."),
      },
    },
    async ({ dir, diff }) => json(tools.environmentsTool(c, dir, diff as [string, string] | undefined)),
  );

  server.registerTool(
    "truspec_docs",
    {
      title: "Document a collection",
      description:
        "Render a collection as Markdown: endpoints, parameters, headers, bodies, assertions, captures, and an example snippet per request. Deterministic — no timestamps — so it can be committed and re-generated without churning the diff.",
      inputSchema: {
        dir: z.string().default(".").describe("Collection directory."),
        lang: z.string().default("curl").describe("Snippet language, or \"none\" to omit examples."),
        title: z.string().optional().describe("Document title."),
      },
    },
    async ({ dir, lang, title }) => json(tools.docsTool(c, dir, lang, title)),
  );

  server.registerTool(
    "truspec_lint",
    {
      title: "Lint a collection",
      description:
        "Static checks over a collection without sending any request: schema errors, committed credentials, unparseable JSONPath, requests with no assertions, duplicate names, undeclared {{vars}}, and insecure URLs. Each finding carries a stable rule id.",
      inputSchema: {
        dir: z.string().default(".").describe("Directory to lint, relative to the workspace."),
        disable: z.array(z.string()).optional().describe("Rule ids to skip."),
      },
    },
    async ({ dir, disable }) => json(tools.lintTool(c, dir, disable)),
  );

  server.registerTool(
    "truspec_import_curl",
    {
      title: "Import a curl command",
      description:
        "Convert one or more pasted `curl` command lines into .tspec.yaml request files (headers, body, and bearer/basic auth are lifted into structured fields).",
      inputSchema: {
        command: z.string().describe("The curl command line(s)."),
        out: z.string().default(".").describe("Directory to write the request file(s) into."),
        name: z.string().optional().describe("Base filename; defaults to a slug of the derived request name."),
      },
    },
    async ({ command, out, name }) => json(tools.importCurlTool(c, command, out, name)),
  );

  server.registerTool(
    "truspec_import_insomnia",
    {
      title: "Import an Insomnia export",
      description:
        "Convert an Insomnia v4/v5 export into .tspec.yaml request files, reassembling its flat parentId list back into folders.",
      inputSchema: {
        path: z.string().describe("Path to the exported JSON."),
        out: z.string().default(".").describe("Directory to write the request file(s) into."),
      },
    },
    async ({ path, out }) => json(tools.importInsomniaTool(c, path, out)),
  );

  server.registerTool(
    "truspec_import_har",
    {
      title: "Import a HAR export",
      description:
        "Convert a HAR (browser devtools 'Save all as HAR') into .tspec.yaml request files. Browser-noise headers are stripped, OPTIONS preflights skipped, and each request asserts the status that was actually recorded.",
      inputSchema: {
        path: z.string().describe("Path to the .har file."),
        out: z.string().default(".").describe("Directory to write the request file(s) into."),
        filter: z.string().optional().describe("Only import entries whose URL contains this substring."),
        baseUrlVar: z
          .string()
          .optional()
          .describe("Replace the recorded origin with this variable, e.g. baseUrl."),
      },
    },
    async ({ path, out, filter, baseUrlVar }) => json(tools.importHarTool(c, path, out, filter, baseUrlVar)),
  );

  server.registerTool(
    "truspec_codegen",
    {
      title: "Generate request code",
      description:
        "Render a .tspec.yaml request as a runnable snippet in another client or language (curl, Python, Go, Java, …). Folder base URL, inherited headers and auth are applied exactly as the runner applies them.",
      inputSchema: {
        path: z.string().describe("Path to a .tspec.yaml file."),
        lang: z
          .string()
          .default("curl")
          .describe("Target id — call truspec_codegen_targets for the list."),
        env: z.string().optional().describe("Environment name, to substitute its variables."),
      },
    },
    async ({ path, lang, env }) => json(tools.codegenTool(c, path, lang, env)),
  );

  server.registerTool(
    "truspec_codegen_targets",
    {
      title: "List code targets",
      description: "List the languages and clients truspec_codegen can render a request into.",
    },
    async () => json(tools.codegenTargetsTool()),
  );

  return server;
}
