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
  opts: { port?: number; host?: string; delayMs?: number; validate?: boolean } = {},
): Promise<MockServerHandle> {
  const responder = createMockResponder(specText, { validate: opts.validate });
  const host = opts.host ?? "127.0.0.1";
  const delayMs = opts.delayMs ?? 0;
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://localhost");
    const query: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    const hasBody = Number(req.headers["content-length"] ?? 0) > 0;
    const result = responder.respond(req.method ?? "GET", u.pathname, { query, hasBody });
    const send = (): void => {
      if (!result) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `No mock for ${req.method} ${u.pathname}` }));
        return;
      }
      res.writeHead(result.status, result.headers);
      res.end(result.body);
    };
    if (delayMs > 0) setTimeout(send, delayMs);
    else send();
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
