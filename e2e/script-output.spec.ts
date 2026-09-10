import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

async function okServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((_q, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"id":7}');
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as { port: number }).port };
}

// A `console.log` in a script was a silent no-op: Node injects a `console` into every vm context,
// so it was defined and wrote nowhere. The browser has no stdout at all, which is why the lines
// travel in the run result — and this is the test that they arrive and are rendered.
test.describe("script output in the response pane (real browser)", () => {
  test("shows what a script printed, in both phases", async ({ app, page }) => {
    const { server, port } = await okServer();
    try {
      writeFileSync(
        join(app.dir, "chatty.tspec.yaml"),
        `tspec: "0.1"
name: Chatty
method: GET
url: "http://127.0.0.1:${port}/x"
script:
  pre: |
    console.log("pre says hello")
  post: |
    console.warn("post saw status", tr.response.status)
assertions: [ { type: status, equals: 200 } ]
`,
      );
      await page.goto(app.url);
      await page.locator(".req", { hasText: "Chatty" }).click();
      await page.click(".req-top .btn.run");
      await expect(page.locator(".response-head .pill")).toHaveCount(1, { timeout: 5000 });

      const logs = page.locator(".script-logs");
      await expect(logs).toContainText("pre says hello");
      await expect(logs).toContainText("post saw status 200");
      // The level is carried through so a warning reads as one.
      await expect(page.locator(".script-log.warn")).toHaveCount(1);
    } finally {
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  test("shows the output of a pre script that threw, which produced no response at all", async ({ app, page }) => {
    writeFileSync(
      join(app.dir, "doomed.tspec.yaml"),
      `tspec: "0.1"
name: Doomed
method: GET
url: "http://127.0.0.1:1/x"
script:
  pre: |
    console.log("got this far")
    nope.boom()
assertions: []
`,
    );
    await page.goto(app.url);
    await page.locator(".req", { hasText: "Doomed" }).click();
    await page.click(".req-top .btn.run");
    await expect(page.locator(".response-head .err")).toContainText("script error", { timeout: 5000 });
    // No response, so the pane's usual content is absent — the script's output is all there is.
    await expect(page.locator(".script-logs")).toContainText("got this far");
  });
});
