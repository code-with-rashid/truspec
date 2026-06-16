import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type ApiContext, handleApi } from "./api";

/** Cap request bodies so a runaway/hostile client can't exhaust memory. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const LOOPBACK_BINDS = new Set(["127.0.0.1", "::1", "localhost"]);
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Defeat DNS rebinding against the local server: when bound to loopback (the
 * default), only honor requests whose Host header is itself loopback. A rebound
 * request from `evil.com` carries `Host: evil.com` and is refused. When the user
 * explicitly binds a non-loopback host they've opted into network exposure, so
 * the guard steps aside.
 */
function hostAllowed(hostHeader: string | undefined, bindHost: string): boolean {
  if (!LOOPBACK_BINDS.has(bindHost)) return true;
  if (!hostHeader) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return false;
  }
  return LOOPBACK_HOSTNAMES.has(hostname);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

export interface WebServerOptions {
  dir?: string;
  port?: number;
  host?: string;
  clientDir?: string;
}

export interface WebServerHandle {
  url: string;
  port: number;
  dir: string;
  close: () => Promise<void>;
}

function serveStatic(clientDir: string, pathname: string, res: ServerResponse): void {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname); // throws URIError on a malformed %-escape
  } catch {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("Bad request");
    return;
  }
  if (rel === "/" || rel === "") rel = "/index.html";
  let filePath = normalize(join(clientDir, rel));
  if (filePath !== clientDir && !filePath.startsWith(clientDir + sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(clientDir, "index.html"); // SPA fallback
  }
  if (!existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Web client not built — run `pnpm --filter @truspec/web build`.");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

/** Start the local TruSpec web server: static client + JSON API backed by @truspec/core. */
export async function startWebServer(opts: WebServerOptions = {}): Promise<WebServerHandle> {
  const dir = resolve(opts.dir ?? process.cwd());
  const host = opts.host ?? "127.0.0.1";
  const clientDir =
    opts.clientDir ?? resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "client");
  const ctx: ApiContext = { dir };

  const server = createServer((req, res) => {
    void (async () => {
      if (!hostAllowed(req.headers.host, host)) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("Forbidden: unexpected Host header");
        return;
      }
      // A malformed request URL (e.g. a bad %-escape) makes `new URL`/decodeURIComponent
      // throw; without this guard the throw becomes an unhandledRejection that hangs the
      // socket and crashes the process. Answer with 400 instead.
      let url: URL;
      try {
        url = new URL(req.url ?? "/", "http://localhost");
      } catch {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("Bad request URL");
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        let body: unknown;
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const c of req) {
            size += (c as Buffer).length;
            if (size > MAX_BODY_BYTES) {
              res.writeHead(413, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "Request body too large" }));
              req.destroy();
              return;
            }
            chunks.push(c as Buffer);
          }
          const raw = Buffer.concat(chunks).toString();
          try {
            body = raw ? JSON.parse(raw) : {};
          } catch {
            body = {};
          }
        }
        try {
          const result = await handleApi(req.method ?? "GET", url.pathname, url.searchParams, body, ctx);
          res.writeHead(result.status, { "content-type": "application/json" });
          res.end(JSON.stringify(result.json));
        } catch (e) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
        return;
      }
      serveStatic(clientDir, url.pathname, res);
    })();
  });

  await new Promise<void>((res2, rej) => {
    server.once("error", rej);
    server.listen(opts.port ?? 4100, host, () => res2());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : (opts.port ?? 4100);
  return {
    url: `http://${host}:${port}`,
    port,
    dir,
    close: () => new Promise((r, j) => server.close((e) => (e ? j(e) : r()))),
  };
}
