import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { runRequest, send } from "../src/runner";

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A fetch double driven by a queue of responses, recording every call. */
function scripted(responses: Array<() => Response>): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  let i = 0;
  const fn = (async (url: string, init?: RequestInit) => {
    seen.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const make = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return make!();
  }) as unknown as typeof fetch;
  return { fetch: fn, seen };
}

const ok = () => new Response('{"ok":true}', { status: 200 });
const status = (code: number) => () => new Response("", { status: code });
const redirect = (code: number, to: string) => () =>
  new Response("", { status: code, headers: { location: to } });

const noSleep = async (): Promise<void> => {};
const GET = { method: "GET", headers: {} };

describe("send — retries", () => {
  it("does not retry by default", async () => {
    const { fetch, seen } = scripted([status(503)]);
    const out = await send("https://api.test/a", GET, { fetch, sleep: noSleep });
    expect(out.response.status).toBe(503);
    expect(out.attempts).toBe(0);
    expect(seen.length).toBe(1);
  });

  it("retries a 503 and returns the first success", async () => {
    const { fetch, seen } = scripted([status(503), status(503), ok]);
    const out = await send("https://api.test/a", GET, {
      fetch,
      sleep: noSleep,
      options: { retries: 3 },
    });
    expect(out.response.status).toBe(200);
    expect(out.attempts).toBe(2);
    expect(seen.length).toBe(3);
  });

  it("retries a 429 but never a 4xx the server meant", async () => {
    const rateLimited = scripted([status(429), ok]);
    expect(
      (await send("https://api.test/a", GET, { fetch: rateLimited.fetch, sleep: noSleep, options: { retries: 2 } }))
        .response.status,
    ).toBe(200);

    const notFound = scripted([status(404)]);
    await send("https://api.test/a", GET, { fetch: notFound.fetch, sleep: noSleep, options: { retries: 3 } });
    expect(notFound.seen.length).toBe(1);
  });

  it("returns the last response rather than looping forever when every attempt fails", async () => {
    const { fetch, seen } = scripted([status(500)]);
    const out = await send("https://api.test/a", GET, { fetch, sleep: noSleep, options: { retries: 2 } });
    expect(out.response.status).toBe(500);
    expect(seen.length).toBe(3); // the original plus two retries
  });

  it("retries a transport error and rethrows once the budget is spent", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls < 3) throw new Error("ECONNRESET");
      return ok();
    }) as unknown as typeof fetch;
    expect(
      (await send("https://api.test/a", GET, { fetch: flaky, sleep: noSleep, options: { retries: 3 } })).response
        .status,
    ).toBe(200);

    const always = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(
      send("https://api.test/a", GET, { fetch: always, sleep: noSleep, options: { retries: 1 } }),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("backs off exponentially, capped", async () => {
    const waits: number[] = [];
    const { fetch } = scripted([status(500)]);
    await send("https://api.test/a", GET, {
      fetch,
      sleep: async (ms) => void waits.push(ms),
      options: { retries: 6, retryDelayMs: 200 },
    });
    expect(waits).toEqual([200, 400, 800, 1600, 3200, 5000]);
  });
});

describe("send — redirects", () => {
  it("does not follow redirects by default, so a 3xx stays assertable", async () => {
    const { fetch, seen } = scripted([redirect(302, "https://api.test/b")]);
    const out = await send("https://api.test/a", GET, { fetch, sleep: noSleep });
    expect(out.response.status).toBe(302);
    expect(out.redirects).toEqual([]);
    expect(seen.length).toBe(1);
  });

  it("follows when asked, reporting each hop", async () => {
    const { fetch, seen } = scripted([
      redirect(302, "https://api.test/b"),
      redirect(302, "/c"),
      ok,
    ]);
    const out = await send("https://api.test/a", GET, {
      fetch,
      sleep: noSleep,
      options: { followRedirects: true },
    });
    expect(out.response.status).toBe(200);
    expect(out.redirects).toEqual(["https://api.test/b", "https://api.test/c"]);
    expect(seen.map((s) => s.url)).toEqual([
      "https://api.test/a",
      "https://api.test/b",
      "https://api.test/c",
    ]);
  });

  it("stops at maxRedirects and returns the 3xx it stopped on", async () => {
    const { fetch, seen } = scripted([redirect(302, "https://api.test/loop")]);
    const out = await send("https://api.test/a", GET, {
      fetch,
      sleep: noSleep,
      options: { followRedirects: true, maxRedirects: 2 },
    });
    expect(out.response.status).toBe(302);
    expect(out.redirects.length).toBe(2);
    expect(seen.length).toBe(3);
  });

  it("downgrades 303 and 301/302-on-POST to a bodiless GET, and drops the body's content headers", async () => {
    for (const code of [303, 301, 302]) {
      const { fetch, seen } = scripted([redirect(code, "https://api.test/b"), ok]);
      await send(
        "https://api.test/a",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"a":1}' },
        { fetch, sleep: noSleep, options: { followRedirects: true } },
      );
      expect(seen[1]!.method, String(code)).toBe("GET");
      expect(seen[1]!.body, String(code)).toBeUndefined();
      expect(seen[1]!.headers["Content-Type"], String(code)).toBeUndefined();
    }
  });

  it("preserves the method and body across 307 and 308", async () => {
    for (const code of [307, 308]) {
      const { fetch, seen } = scripted([redirect(code, "https://api.test/b"), ok]);
      await send(
        "https://api.test/a",
        { method: "POST", headers: {}, body: '{"a":1}' },
        { fetch, sleep: noSleep, options: { followRedirects: true } },
      );
      expect(seen[1]!.method, String(code)).toBe("POST");
      expect(seen[1]!.body, String(code)).toBe('{"a":1}');
    }
  });

  it("keeps Authorization on a same-origin hop but drops it when the origin changes", async () => {
    const same = scripted([redirect(302, "https://api.test/b"), ok]);
    await send(
      "https://api.test/a",
      { method: "GET", headers: { Authorization: "Bearer s3cret", Cookie: "sid=1" } },
      { fetch: same.fetch, sleep: noSleep, options: { followRedirects: true } },
    );
    expect(same.seen[1]!.headers.Authorization).toBe("Bearer s3cret");

    const cross = scripted([redirect(302, "https://evil.test/steal"), ok]);
    await send(
      "https://api.test/a",
      { method: "GET", headers: { Authorization: "Bearer s3cret", Cookie: "sid=1" } },
      { fetch: cross.fetch, sleep: noSleep, options: { followRedirects: true } },
    );
    expect(cross.seen[1]!.headers.Authorization).toBeUndefined();
    expect(cross.seen[1]!.headers.Cookie).toBeUndefined();
  });

  it("returns the 3xx untouched when Location is unusable", async () => {
    const { fetch } = scripted([() => new Response("", { status: 302, headers: { location: "http://" } })]);
    const out = await send("https://api.test/a", GET, {
      fetch,
      sleep: noSleep,
      options: { followRedirects: true },
    });
    expect(out.response.status).toBe(302);
    expect(out.redirects).toEqual([]);
  });
});

describe("runRequest with options", () => {
  it("reports retries and redirects on the result", async () => {
    const { fetch } = scripted([status(503), redirect(302, "https://api.test/final"), ok]);
    const req = parse.request.parse(`
name: Flaky
url: "https://api.test/a"
options: { retries: 2, followRedirects: true }
assertions:
  - { type: status, equals: 200 }
`);
    const result = await runRequest(req, { fetch, sleep: noSleep });
    expect(result.ok).toBe(true);
    expect(result.retries).toBe(1);
    expect(result.redirects).toEqual(["https://api.test/final"]);
  });

  it("omits the redirect and retry fields entirely when neither happened", async () => {
    const { fetch } = scripted([ok]);
    const req = parse.request.parse(`name: r\nurl: "https://api.test/a"\nassertions: []`);
    const result = await runRequest(req, { fetch, sleep: noSleep });
    expect(result.redirects).toBeUndefined();
    expect(result.retries).toBeUndefined();
  });

  it("lets a request's own timeout override the run-wide one", async () => {
    const seenTimeouts: Array<number | undefined> = [];
    const fetchWithSignal = (async (_url: string, init?: RequestInit) => {
      // AbortSignal.timeout() gives no readable duration, so record only whether one was attached.
      seenTimeouts.push(init?.signal ? 1 : undefined);
      return ok();
    }) as unknown as typeof fetch;
    const off = parse.request.parse(
      `name: r\nurl: "https://api.test/a"\noptions: { timeoutMs: 0 }\nassertions: []`,
    );
    await runRequest(off, { fetch: fetchWithSignal, timeoutMs: 30_000 });
    expect(seenTimeouts).toEqual([undefined]);
  });
});

describe("why the redirect chain stopped", () => {
  it("reports the limit when the cap ended it, and not when the server did", async () => {
    // The distinction the report needs: a 302 that is the server's final answer, versus a 302 that
    // is simply where we gave up. Both look identical in the status alone.
    let hops = 0;
    const server = createServer((_q, res) => {
      hops += 1;
      if (hops <= 2) {
        res.writeHead(302, { location: `http://127.0.0.1:${port}/step${hops}` });
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      hops = 0;
      const complete = await send(
        `http://127.0.0.1:${port}/start`,
        { method: "GET", headers: {} },
        { fetch, options: { followRedirects: true } },
      );
      expect(complete.response.status).toBe(200);
      expect(complete.redirects).toHaveLength(2);
      expect(complete.redirectLimitHit).toBe(false);

      hops = 0;
      const capped = await send(
        `http://127.0.0.1:${port}/start`,
        { method: "GET", headers: {} },
        { fetch, options: { followRedirects: true, maxRedirects: 1 } },
      );
      expect(capped.response.status).toBe(302);
      expect(capped.redirects).toHaveLength(1);
      expect(capped.redirectLimitHit).toBe(true);
    } finally {
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  it("does not call a 302 a limit when following is off", async () => {
    // maxRedirects is 0 in that case, but "we never follow" is not "we gave up".
    const server = createServer((_q, res) => {
      res.writeHead(302, { location: "http://example.invalid/next" });
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const r = await send(`http://127.0.0.1:${port}/x`, { method: "GET", headers: {} }, { fetch });
      expect(r.response.status).toBe(302);
      expect(r.redirects).toEqual([]);
      expect(r.redirectLimitHit).toBe(false);
    } finally {
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });
});
