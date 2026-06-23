import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base } from "@playwright/test";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

export interface App {
  url: string;
  /** Absolute path to the temp workspace the server is serving (for server-side assertions). */
  dir: string;
}

// A per-test web server over a fresh temp workspace (with a benign request, an XSS-payload-named
// request, an env, and a spec) plus a mock upstream so `run` succeeds.
export const test = base.extend<{ app: App }>({
  app: async ({}, use) => {
    const { startWebServer } = (await import(`${ROOT}/packages/web/dist/server/index.js`)) as {
      startWebServer: (o: { dir: string; port: number; clientDir: string }) => Promise<{ url: string; close: () => Promise<void> }>;
    };
    const mock = createServer((_q, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"id":1,"name":"Rex"}'); });
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", () => r()));
    const mockPort = (mock.address() as { port: number }).port;

    const dir = mkdtempSync(join(tmpdir(), "tspec-e2e-"));
    mkdirSync(join(dir, "environments"), { recursive: true });
    writeFileSync(join(dir, "environments", "local.env.yaml"), `tspec: "0.1"\nname: local\nvariables: { baseUrl: "http://127.0.0.1:${mockPort}" }\n`);
    writeFileSync(join(dir, "get.tspec.yaml"), 'tspec: "0.1"\nname: Get pet\nmethod: GET\nurl: "{{baseUrl}}/pets/1"\nspec: { operation: "GET /pets/{id}" }\nassertions: [ { type: status, equals: 200 } ]\n');
    // XSS probe: a request name that WOULD execute if the UI didn't escape it.
    writeFileSync(join(dir, "evil.tspec.yaml"), 'tspec: "0.1"\nname: "<img src=x onerror=\\"window.__xss=true\\">"\nmethod: GET\nurl: "{{baseUrl}}/x"\nassertions: []\n');
    writeFileSync(join(dir, "openapi.yaml"), 'openapi: 3.0.3\ninfo: { title: T, version: "1" }\npaths:\n  /pets/{id}: { get: { operationId: getPet, responses: { "200": {} } } }\n  /other: { get: { responses: { "200": {} } } }\n');

    const web = await startWebServer({ dir, port: 0, clientDir: `${ROOT}/packages/web/dist/client` });
    await use({ url: web.url, dir });
    await web.close();
    await new Promise((r) => mock.close(() => r(undefined)));
    rmSync(dir, { recursive: true, force: true });
  },
});

export { expect } from "@playwright/test";
