import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

/** A server returning a JSON array of `rows` objects, so the body size is controllable. */
async function bigServer(rows: number): Promise<{ server: Server; port: number; bytes: number }> {
  const body = JSON.stringify(
    Array.from({ length: rows }, (_, i) => ({ id: i, name: `item-${i}`, active: i % 2 === 0, score: i * 1.5 })),
  );
  const server = createServer((_q, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as { port: number }).port, bytes: body.length };
}

test.describe("a large response body (real browser)", () => {
  test("renders promptly and stays interactive instead of locking the tab", async ({ app, page }) => {
    // A single unpaginated list endpoint is enough to produce this. Syntax-highlighting emits one
    // <span> per token, so a ~1MB body used to become ~480,000 DOM nodes.
    const { server, port, bytes } = await bigServer(20_000);
    try {
      writeFileSync(
        join(app.dir, "big.tspec.yaml"),
        `tspec: "0.1"\nname: Big\nmethod: GET\nurl: "http://127.0.0.1:${port}/big"\nassertions: [ { type: status, equals: 200 } ]\n`,
      );
      await page.goto(app.url);
      await page.locator(".req", { hasText: "Big" }).click();

      const started = Date.now();
      await page.locator(".btn.run", { hasText: "send" }).click();
      await expect(page.locator(".response-body")).toBeVisible({ timeout: 30_000 });
      const elapsed = Date.now() - started;

      // The page must still answer, promptly, after rendering it.
      const t0 = Date.now();
      await page.locator(".url-input").click();
      const interactive = Date.now() - t0;

      const spans = await page.locator("pre.body span").count();
      // eslint-disable-next-line no-console
      console.log(`large-response: ${(bytes / 1048576).toFixed(2)}MB body, rendered in ${elapsed}ms, ${spans} spans, click took ${interactive}ms`);

      expect(spans, "one span per token would be hundreds of thousands").toBeLessThan(20_000);
      expect(interactive, "the page must stay responsive").toBeLessThan(5_000);
    } finally {
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  test("says the view is truncated rather than showing part of a body as if it were all of it", async ({ app, page }) => {
    const { server, port } = await bigServer(20_000);
    try {
      writeFileSync(
        join(app.dir, "big.tspec.yaml"),
        `tspec: "0.1"\nname: Big\nmethod: GET\nurl: "http://127.0.0.1:${port}/big"\nassertions: [ { type: status, equals: 200 } ]\n`,
      );
      await page.goto(app.url);
      await page.locator(".req", { hasText: "Big" }).click();
      await page.locator(".btn.run", { hasText: "send" }).click();
      await expect(page.locator(".response-body")).toBeVisible({ timeout: 30_000 });

      // Whatever the viewer does to stay fast, it must not quietly present a partial body.
      await expect(page.locator(".body-truncated")).toContainText(/showing/i);
    } finally {
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  test("truncates a body past the render limit, and says how much it is showing", async ({ app, page }) => {
    // ~3.5MB, past the 2MB render limit. The notice must state both numbers: a viewer that shows
    // part of a body without saying so is worse than one that shows none of it.
    const { server, port } = await bigServer(60_000);
    try {
      writeFileSync(
        join(app.dir, "big.tspec.yaml"),
        `tspec: "0.1"\nname: Big\nmethod: GET\nurl: "http://127.0.0.1:${port}/big"\nassertions: [ { type: status, equals: 200 } ]\n`,
      );
      await page.goto(app.url);
      await page.locator(".req", { hasText: "Big" }).click();
      await page.locator(".btn.run", { hasText: "send" }).click();
      await expect(page.locator(".response-body")).toBeVisible({ timeout: 30_000 });

      await expect(page.locator(".body-truncated")).toContainText("showing the first 2048KB");
      await expect(page.locator(".body-truncated")).toContainText("Save or copy the response");
    } finally {
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  test("leaves an ordinary response highlighted and unannotated", async ({ app, page }) => {
    // The bound must not cost anything for the responses people actually look at all day.
    await page.goto(app.url);
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".btn.run", { hasText: "send" }).click();
    await expect(page.locator(".response-body")).toBeVisible();

    expect(await page.locator("pre.body span").count()).toBeGreaterThan(0);
    await expect(page.locator(".body-truncated")).toHaveCount(0);
  });
});
