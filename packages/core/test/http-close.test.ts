import { Agent, createServer, get, type RequestListener, type Server } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { closeHttpServer } from "../src/http/close";

const servers: Server[] = [];

/** A server on an ephemeral port, torn down even if the assertion throws. */
async function listen(handler?: RequestListener): Promise<{ server: Server; port: number }> {
  const server = handler ? createServer(handler) : createServer((_q, res) => res.end("ok"));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as { port: number }).port };
}

afterEach(() => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    s.close();
  }
});

describe("closeHttpServer", () => {
  it("resolves when nothing is connected", async () => {
    const { server } = await listen();
    await expect(closeHttpServer(server)).resolves.toBeUndefined();
  });

  it("resolves for a socket that connected but never sent a request", async () => {
    // The regression this exists for: Chromium preconnects, and a bare `server.close()` waits on
    // such a socket forever — it is not "idle" in Node's sense, because no request ever used it.
    const { server, port } = await listen();
    const sock = connect(port, "127.0.0.1");
    await new Promise<void>((r) => sock.once("connect", () => r()));

    const started = Date.now();
    await closeHttpServer(server, 50);
    expect(Date.now() - started).toBeLessThan(2000);
    sock.destroy();
  });

  it("resolves for a parked keep-alive socket", async () => {
    const { server, port } = await listen();
    const agent = new Agent({ keepAlive: true, keepAliveMsecs: 60_000 });
    await new Promise<void>((r) => {
      get({ port, host: "127.0.0.1", agent }, (res) => {
        res.resume();
        res.once("end", () => r());
      });
    });

    await expect(closeHttpServer(server, 50)).resolves.toBeUndefined();
    agent.destroy();
  });

  it("lets a response already in flight finish before destroying sockets", async () => {
    const { server, port } = await listen((_q, res) => {
      setTimeout(() => res.end("late"), 30);
    });
    const body = new Promise<string>((resolveBody) => {
      get({ port, host: "127.0.0.1" }, (res) => {
        let text = "";
        res.on("data", (c) => (text += String(c)));
        res.once("end", () => resolveBody(text));
      });
    });
    // Let the request reach the handler, so it is genuinely in flight when we close.
    await new Promise<void>((r) => setTimeout(r, 5));

    const started = Date.now();
    await closeHttpServer(server, 5000);
    expect(await body).toBe("late");
    // And it returns as soon as that socket falls idle — it does not sit out the whole grace,
    // which is what a single close-time sweep would do.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("treats an already-closed server as success, not an error", async () => {
    const { server } = await listen();
    await closeHttpServer(server);
    await expect(closeHttpServer(server)).resolves.toBeUndefined();
  });
});
