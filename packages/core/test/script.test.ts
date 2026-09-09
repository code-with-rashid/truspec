import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { runPostScript, runPreScript, runRequest } from "../src/runner";

const okJson = (body: unknown): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

describe("runPostScript", () => {
  const res = { status: 200, headers: {}, bodyText: '{"token":"t"}', json: { token: "t" }, durationMs: 1 };

  it("sets variables and records expectations", () => {
    const r = runPostScript(
      'tr.set("tok", tr.response.json.token); tr.expect(tr.response.status === 200, "ok status");',
      res,
      {},
    );
    expect(r.captured).toEqual({ tok: "t" });
    expect(r.assertions).toEqual([{ type: "script", ok: true, message: "ok status" }]);
  });

  it("reports a failing expectation", () => {
    const r = runPostScript("tr.expect(false)", res, {});
    expect(r.assertions[0]?.ok).toBe(false);
  });

  it("captures runtime errors", () => {
    const r = runPostScript("throw new Error('boom')", res, {});
    expect(r.error).toMatch(/boom/);
  });
});

describe("runPreScript", () => {
  it("sets variables, reading from tr.vars", () => {
    expect(runPreScript('tr.set("x", 5); tr.set("y", tr.vars.a)', { a: "1" }).vars).toEqual({ x: 5, y: "1" });
  });

  it("exposes uuid / base64 / hmac helpers", () => {
    const r = runPreScript(
      'tr.set("id", tr.uuid()); tr.set("b", tr.base64("hi")); tr.set("sig", tr.hmac("sha256", "k", "data")); tr.set("sig64", tr.hmac("sha256", "k", "data", "base64"))',
      {},
    );
    expect(r.vars.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(r.vars.b).toBe("aGk=");
    expect(r.vars.sig).toMatch(/^[0-9a-f]{64}$/); // hex digest
    expect(typeof r.vars.sig64).toBe("string");
    expect(r.vars.sig64).not.toBe(r.vars.sig); // base64 differs from hex
  });

  it("captures runtime errors instead of throwing", () => {
    const r = runPreScript('throw new Error("preboom")', {});
    expect(r.error).toMatch(/preboom/);
  });
});

describe("runRequest with a pre script", () => {
  it("feeds a script-computed variable into the request URL", async () => {
    const req = parse.request.parse(
      'name: r\nurl: "http://x/{{token}}"\nscript: { pre: "tr.set(\\"token\\", tr.uuid())" }',
    );
    let calledUrl = "";
    const fetchSpy = (async (url: string | URL | Request) => {
      calledUrl = String(url);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const result = await runRequest(req, { fetch: fetchSpy });
    expect(result.ok).toBe(true);
    expect(calledUrl).toMatch(/^http:\/\/x\/[0-9a-f-]{36}$/);
  });

  it("fails the run (without sending) when the pre script throws", async () => {
    let called = false;
    const fetchSpy = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const req = parse.request.parse('name: r\nurl: http://x\nscript: { pre: "throw new Error(\\"preboom\\")" }');
    const result = await runRequest(req, { fetch: fetchSpy });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Pre-request script error.*preboom/);
    expect(called).toBe(false);
  });

  it("times out an infinite-loop pre script instead of hanging (and never sends)", async () => {
    let called = false;
    const fetchSpy = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const req = parse.request.parse('name: r\nurl: http://x\nscript: { pre: "while(true){}" }');
    const result = await runRequest(req, { fetch: fetchSpy }); // vm caps it at 1s; test must not hang
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Pre-request script error/);
    expect(called).toBe(false);
  });
});

describe("runRequest with a post script", () => {
  it("fails the run when a script expectation fails", async () => {
    const req = parse.request.parse('name: r\nurl: http://x\nscript: { post: "tr.expect(false)" }');
    const result = await runRequest(req, { fetch: okJson({}) });
    expect(result.ok).toBe(false);
    expect(result.assertions.some((a) => a.type === "script" && !a.ok)).toBe(true);
  });

  it("captures a variable set by a script", async () => {
    const req = parse.request.parse(
      'name: r\nurl: http://x\nscript: { post: "tr.set(\\"id\\", tr.response.json.id)" }',
    );
    const result = await runRequest(req, { fetch: okJson({ id: 7 }) });
    expect(result.captured).toEqual({ id: 7 });
  });
});

describe("script console output", () => {
  it("collects what a pre script prints, instead of dropping it", () => {
    const r = runPreScript('console.log("hello", 42)', {});
    expect(r.logs).toEqual([{ level: "log", message: "hello 42" }]);
  });

  it("collects each level separately, so a surface can style them", () => {
    const r = runPreScript('console.warn("w"); console.error("e"); console.debug("d"); console.info("i")', {});
    expect(r.logs.map((l) => l.level)).toEqual(["warn", "error", "debug", "info"]);
  });

  it("formats an object the way Node's console does, not as [object Object]", () => {
    const r = runPreScript('console.log({ a: 1, b: [1, 2] })', {});
    expect(r.logs[0]!.message).toBe("{ a: 1, b: [ 1, 2 ] }");
    expect(r.logs[0]!.message).not.toContain("[object Object]");
  });

  it("keeps the output a failing script produced before it threw", () => {
    const r = runPreScript('console.log("got this far"); nope.boom()', {});
    expect(r.error).toMatch(/nope is not defined/);
    expect(r.logs).toEqual([{ level: "log", message: "got this far" }]);
  });

  it("collects from a post script too, alongside its assertions", () => {
    const r = runPostScript(
      'console.log("status is", tr.response.status); tr.expect(true, "ok")',
      { status: 201, headers: {}, bodyText: "", durationMs: 5 },
      {},
    );
    expect(r.logs).toEqual([{ level: "log", message: "status is 201" }]);
    expect(r.assertions).toHaveLength(1);
  });

  it("caps a runaway loop, and says so rather than silently truncating", () => {
    const r = runPreScript("for (let i = 0; i < 500; i++) console.log(i)", {});
    expect(r.logs).toHaveLength(101);
    expect(r.logs[100]).toEqual({ level: "warn", message: "… further output suppressed after 100 lines." });
  });

  it("caps a single enormous line", () => {
    const r = runPreScript('console.log("x".repeat(50000))', {});
    expect(r.logs[0]!.message).toHaveLength(2001);
    expect(r.logs[0]!.message.endsWith("…")).toBe(true);
  });

  it("reports nothing when a script prints nothing", () => {
    expect(runPreScript('tr.set("a", 1)', {}).logs).toEqual([]);
  });

  it("carries the lines out on the run result, from both phases", async () => {
    const req = parse.request.parse(
      `tspec: "0.1"
name: Chatty
url: "https://api.test/x"
script:
  pre: |
    console.log("before")
  post: |
    console.log("after")
assertions:
  - { type: status, equals: 200 }
`,
    );
    const result = await runRequest(req, {
      fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
    });
    expect(result.scriptLogs).toEqual([
      { level: "log", message: "before" },
      { level: "log", message: "after" },
    ]);
  });

  it("carries them out even when the pre script threw and no request was sent", async () => {
    const req = parse.request.parse(
      `tspec: "0.1"
name: Doomed
url: "https://api.test/x"
script:
  pre: |
    console.log("got this far")
    nope.boom()
assertions: []
`,
    );
    let sent = false;
    const result = await runRequest(req, {
      fetch: (async () => {
        sent = true;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(sent).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.scriptLogs).toEqual([{ level: "log", message: "got this far" }]);
  });

  it("omits the field entirely when nothing was printed", async () => {
    const req = parse.request.parse('tspec: "0.1"\nname: Quiet\nurl: "https://api.test/x"\nassertions: []\n');
    const result = await runRequest(req, {
      fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
    });
    expect(result.scriptLogs).toBeUndefined();
  });
});
