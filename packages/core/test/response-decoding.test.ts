import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeResponseBody, runRequest } from "../src/runner";

const LATIN1 = Buffer.from("caf\xe9 na\xefve r\xe9sum\xe9", "latin1");
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

let server: Server;
let base = "";
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/latin1") {
      res.writeHead(200, { "content-type": "text/plain; charset=iso-8859-1" });
      return res.end(LATIN1);
    }
    if (req.url === "/utf8") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      return res.end("café");
    }
    if (req.url === "/bom") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(Buffer.concat([BOM, Buffer.from('{"id":7,"name":"Rex"}')]));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"id":7}');
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("decodeResponseBody", () => {
  it("honours a declared charset", () => {
    expect(decodeResponseBody(LATIN1, "text/plain; charset=iso-8859-1")).toBe("café naïve résumé");
    expect(decodeResponseBody(LATIN1, 'text/plain; charset="ISO-8859-1"')).toBe("café naïve résumé");
  });

  it("defaults to UTF-8 when none is declared", () => {
    // HTTP's historical default is latin-1, but a response that omits a charset today means UTF-8,
    // and decoding a modern JSON API as latin-1 would corrupt every non-ASCII byte in it.
    expect(decodeResponseBody(Buffer.from("café", "utf8"), "application/json")).toBe("café");
  });

  it("falls back to UTF-8 for a charset label nothing knows", () => {
    expect(decodeResponseBody(Buffer.from("hi", "utf8"), "text/plain; charset=x-made-up")).toBe("hi");
  });

  it("strips a BOM, which is an encoding marker rather than content", () => {
    expect(decodeResponseBody(Buffer.concat([BOM, Buffer.from("{}")]), "application/json")).toBe("{}");
    expect(decodeResponseBody(Buffer.from("{}"), "application/json")).toBe("{}");
  });
});

describe("a response the runner has to decode", () => {
  it("matches a body assertion against what the server actually sent", async () => {
    const r = await runRequest(
      {
        tspec: "0.1",
        name: "latin1",
        method: "GET",
        url: `${base}/latin1`,
        assertions: [{ type: "body", contains: "café" }],
      },
      {},
    );
    expect(r.assertions[0]?.ok, r.assertions[0]?.message).toBe(true);
    expect(r.response?.bodyText).toBe("café naïve résumé");
  });

  it("parses JSON that arrives with a BOM", async () => {
    // The failure this pins: a .NET or PHP stack emits a UTF-8 BOM, JSON.parse throws on it, and
    // *every* jsonpath assertion reports "(no match)" against a 200 whose body is plainly right —
    // with nothing visible in any viewer to explain it.
    const r = await runRequest(
      {
        tspec: "0.1",
        name: "bom",
        method: "GET",
        url: `${base}/bom`,
        assertions: [
          { type: "jsonpath", path: "$.id", equals: 7 },
          { type: "jsonpath", path: "$.name", equals: "Rex" },
        ],
      },
      {},
    );
    expect(r.assertions.map((a) => a.ok)).toEqual([true, true]);
    expect(r.ok).toBe(true);
  });
});

describe("a body that is not text at all", () => {
  const PNG = Buffer.from(
    `89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100${"05fe02fe".repeat(4)}`,
    "hex",
  );
  let bin: Server;
  let binBase = "";
  beforeAll(async () => {
    bin = createServer((req, res) => {
      if (req.url === "/png") {
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(PNG);
      }
      // Text mislabelled as bytes: content type says octet-stream, content says JSON.
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end('{"id":1}');
    });
    await new Promise<void>((r) => bin.listen(0, "127.0.0.1", () => r()));
    binBase = `http://127.0.0.1:${(bin.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((r) => bin.close(() => r())));

  it("is flagged, sized, and carried through byte-for-byte", async () => {
    // Without the bytes, every client can offer is to save the lossy decode — a PNG saved that
    // way does not open.
    const r = await runRequest(
      { tspec: "0.1", name: "png", method: "GET", url: `${binBase}/png`, assertions: [] },
      {},
    );
    expect(r.response?.binary).toBe(true);
    expect(r.response?.bytes).toBe(PNG.byteLength);
    expect(Buffer.from(r.response?.bodyBase64 ?? "", "base64").equals(PNG)).toBe(true);
    expect(r.response?.bodyText.length).toBeLessThan(PNG.byteLength); // the decode really is lossy
  });

  it("judges by content, not by the label the server put on it", async () => {
    // Plenty of servers send JSON as application/octet-stream. Treating that as binary would hide
    // a readable body behind a "binary response" notice.
    const r = await runRequest(
      {
        tspec: "0.1",
        name: "mislabelled",
        method: "GET",
        url: `${binBase}/json`,
        assertions: [{ type: "jsonpath", path: "$.id", equals: 1 }],
      },
      {},
    );
    expect(r.response?.binary).toBeUndefined();
    expect(r.response?.bodyBase64).toBeUndefined();
    expect(r.assertions[0]?.ok).toBe(true);
  });

  it("reports the size in bytes, not in decoded characters", async () => {
    // The response header showed `bodyText.length` labelled "b" — the character count of a decoded
    // string, which is not the size of anything. "café" is 4 characters and 5 bytes in UTF-8.
    const r = await runRequest(
      { tspec: "0.1", name: "utf8", method: "GET", url: `${base}/utf8`, assertions: [] },
      {},
    );
    expect(r.response?.bodyText).toBe("café");
    expect(r.response?.bodyText.length).toBe(4);
    expect(r.response?.bytes).toBe(5);
  });
});
