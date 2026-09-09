import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_STREAM_EVENTS, parseEventStream, runRequest } from "../src/runner";

describe("parseEventStream", () => {
  it("reads the fields a browser would", () => {
    expect(
      parseEventStream('event: token\ndata: {"i":1}\nid: 7\n\nevent: done\ndata: [DONE]\n\n'),
    ).toEqual([
      { event: "token", data: '{"i":1}', id: "7" },
      { event: "done", data: "[DONE]" },
    ]);
  });

  it("joins multi-line data with a newline, as the spec says", () => {
    expect(parseEventStream("data: one\ndata: two\n\n")).toEqual([{ data: "one\ntwo" }]);
  });

  it("drops comments, which is what most keep-alives are made of", () => {
    expect(parseEventStream(": ping\n\ndata: real\n\n: ping\n\n")).toEqual([{ data: "real" }]);
  });

  it("removes exactly one leading space from a value", () => {
    expect(parseEventStream("data:  two spaces\n\n")).toEqual([{ data: " two spaces" }]);
  });

  it("accepts CRLF and bare CR line endings", () => {
    expect(parseEventStream("data: a\r\n\r\ndata: b\r\r")).toEqual([{ data: "a" }, { data: "b" }]);
  });

  it("ignores a block with no data, and unknown fields", () => {
    expect(parseEventStream("event: ping\n\nretry: 100\n\ndata: x\n\n")).toEqual([{ data: "x" }]);
  });
});

let server: Server;
let base = "";
const timers: NodeJS.Timeout[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/finite") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (let i = 1; i <= 3; i++) res.write(`event: token\ndata: {"i":${i}}\n\n`);
      res.write("event: done\ndata: [DONE]\n\n");
      return void res.end();
    }
    if (req.url === "/endless") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const t = setInterval(() => res.write("data: tick\n\n"), 20);
      timers.push(t);
      res.on("close", () => clearInterval(t));
      return;
    }
    if (req.url === "/slowjson") {
      // Half a JSON document, then silence: the shape a non-stream timeout has.
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"half":');
      return;
    }
    if (req.url === "/flood") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const t = setInterval(() => {
        for (let i = 0; i < 100; i++) res.write("data: x\n\n");
      }, 5);
      timers.push(t);
      res.on("close", () => clearInterval(t));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  for (const t of timers) clearInterval(t);
  await new Promise<void>((r) => server.close(() => r()));
});

const get = (path: string, options?: Record<string, unknown>) =>
  runRequest(
    {
      tspec: "0.1",
      name: "s",
      method: "GET",
      url: `${base}${path}`,
      assertions: [{ type: "status", equals: 200 }],
      ...(options ? { options } : {}),
    } as never,
    {},
  );

describe("a server-sent event stream", () => {
  it("comes back as events, with the raw stream still available", async () => {
    const r = await get("/finite");
    expect(r.ok).toBe(true);
    expect(r.response?.events).toEqual([
      { event: "token", data: '{"i":1}' },
      { event: "token", data: '{"i":2}' },
      { event: "token", data: '{"i":3}' },
      { event: "done", data: "[DONE]" },
    ]);
    expect(r.response?.streamTruncated).toBeUndefined();
    expect(r.response?.bodyText).toContain("event: done");
  });

  it("returns what arrived when the timeout closes a stream that never ends", async () => {
    // Before this the request timed out and reported nothing at all — no status, no body —
    // discarding everything the server had already sent, which for a streaming endpoint is the
    // entire response.
    const r = await get("/endless", { timeoutMs: 400 });
    expect(r.error).toBeUndefined();
    expect(r.response?.status).toBe(200);
    expect(r.response?.events?.length).toBeGreaterThan(2);
    expect(r.response?.streamTruncated).toBe(true);
    expect(r.response?.events?.[0]).toEqual({ data: "tick" });
  });

  it("stops at the event cap rather than waiting for the timeout", async () => {
    const started = Date.now();
    const r = await get("/flood", { timeoutMs: 10_000 });
    expect(r.response?.events?.length).toBeGreaterThanOrEqual(MAX_STREAM_EVENTS);
    expect(r.response?.streamTruncated).toBe(true);
    // The point of the cap: it returns in its own time, not the timeout's.
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("leaves an ordinary JSON response alone", async () => {
    const r = await get("/json");
    expect(r.response?.events).toBeUndefined();
    expect(r.response?.streamTruncated).toBeUndefined();
    expect(r.response?.bodyText).toBe('{"ok":true}');
  });

  it("still fails a non-stream request that times out, rather than returning half a body", async () => {
    // Half a JSON document is not a response — salvaging it would report a 200 for a request that
    // did not complete. Only a stream, whose events are complete in themselves, is kept.
    const r = await runRequest(
      { tspec: "0.1", name: "t", method: "GET", url: `${base}/slowjson`, assertions: [] } as never,
      { timeoutMs: 300 },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Timed out/);
    expect(r.response).toBeUndefined();
  });

  it("fails a stream that timed out before sending anything, since there is nothing to report", async () => {
    const r = await runRequest(
      { tspec: "0.1", name: "t", method: "GET", url: `${base}/endless`, assertions: [] } as never,
      { timeoutMs: 1 },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Timed out/);
  });
});
