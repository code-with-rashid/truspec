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
    // Every code path that can throw (a malformed request URL, an invalid status/header reaching
    // `res.writeHead`) is guarded so a single bad request can never become an uncaught exception
    // that crashes the long-running mock process. `send` is wrapped separately because it may run
    // on a later tick via setTimeout, where the outer try/catch would no longer apply.
    const fail = (code: number, msg: string): void => {
      try {
        if (!res.headersSent) {
          res.writeHead(code, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: msg }));
        } else if (!res.writableEnded) {
          res.end();
        }
      } catch {
        // socket already gone — nothing more to do
      }
    };
    let u: URL;
    try {
      u = new URL(req.url ?? "/", "http://localhost");
    } catch {
      fail(400, "Bad request URL");
      return;
    }
    const query: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    const hasBody = Number(req.headers["content-length"] ?? 0) > 0;
    const send = (): void => {
      try {
        const result = responder.respond(req.method ?? "GET", u.pathname, { query, hasBody });
        if (!result) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `No mock for ${req.method} ${u.pathname}` }));
          return;
        }
        res.writeHead(result.status, result.headers);
        res.end(result.body);
      } catch {
        fail(500, "Mock failed to build a response");
      }
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
