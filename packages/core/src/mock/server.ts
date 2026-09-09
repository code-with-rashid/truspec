import { createServer, type IncomingMessage } from "node:http";
import { closeHttpServer } from "../http/close";
import { createMockResponder } from "./engine";

export interface MockServerHandle {
  port: number;
  url: string;
  routes: number;
  close: () => Promise<void>;
}

export interface MockRequestLogEntry {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

/** Start a local HTTP mock server from OpenAPI text. Port 0 picks a free port. */
/** A local mock has no reason to buffer more than this from a client. */
const MAX_MOCK_BODY_BYTES = 2 * 1024 * 1024;

/** Collect a request body as text, rejecting once it exceeds `maxBytes`. */
function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.byteLength;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function startMockServer(
  specText: string,
  opts: {
    port?: number;
    host?: string;
    delayMs?: number;
    validate?: boolean;
    /** Called once per request after the response is sent (or would have been, on failure). */
    onRequest?: (entry: MockRequestLogEntry) => void;
  } = {},
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
    const method = req.method ?? "GET";
    const send = (bodyText: string): void => {
      const t0 = Date.now();
      const log = (status: number): void => {
        opts.onRequest?.({ method, path: u.pathname, status, durationMs: Date.now() - t0 });
      };
      try {
        const result = responder.respond(method, u.pathname, {
          query,
          hasBody,
          bodyText,
          contentType: req.headers["content-type"],
        });
        if (!result) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `No mock for ${method} ${u.pathname}` }));
          log(404);
          return;
        }
        res.writeHead(result.status, result.headers);
        res.end(result.body);
        log(result.status);
      } catch {
        fail(500, "Mock failed to build a response");
        log(500);
      }
    };
    // Read the body before answering: with `--validate` the mock checks it against the schema its
    // operation declares, and it cannot do that from a content-length alone. Bounded, because a
    // local mock should refuse a body rather than buffer whatever arrives.
    readBody(req, MAX_MOCK_BODY_BYTES)
      .then((bodyText) => {
        if (delayMs > 0) setTimeout(() => send(bodyText), delayMs);
        else send(bodyText);
      })
      .catch(() => fail(413, "Request body too large"));
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
    close: () => closeHttpServer(server),
  };
}
