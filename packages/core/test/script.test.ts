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
