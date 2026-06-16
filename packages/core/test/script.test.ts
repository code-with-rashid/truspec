import { describe, expect, it } from "vitest";
import { parse } from "../src/format";
import { runPostScript, runRequest } from "../src/runner";

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
