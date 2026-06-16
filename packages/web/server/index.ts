import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ApiContext, handleApi } from "./api";

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
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  let filePath = normalize(join(clientDir, rel));
  if (!filePath.startsWith(clientDir)) {
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
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        let body: unknown;
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
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
