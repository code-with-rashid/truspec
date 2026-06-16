import { createServer } from "node:http";
import { createMockResponder } from "./engine";

export interface MockServerHandle {
  port: number;
  url: string;
  routes: number;
  close: () => Promise<void>;
}

/** Start a local HTTP mock server from OpenAPI text. Port 0 picks a free port. */
export async function startMockServer(
  specText: string,
  opts: { port?: number; host?: string } = {},
): Promise<MockServerHandle> {
  const responder = createMockResponder(specText);
  const host = opts.host ?? "127.0.0.1";
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const result = responder.respond(req.method ?? "GET", path);
    if (!result) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `No mock for ${req.method} ${path}` }));
      return;
    }
    res.writeHead(result.status, result.headers);
    res.end(result.body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : (opts.port ?? 0);
  return {
    port,
    url: `http://${host}:${port}`,
    routes: responder.routes.length,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
