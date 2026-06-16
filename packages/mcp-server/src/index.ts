import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";

async function main(): Promise<void> {
  const server = createServer({ cwd: process.cwd() });
  await server.connect(new StdioServerTransport());
}

main().catch((e: unknown) => {
  process.stderr.write(`truspec-mcp failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
