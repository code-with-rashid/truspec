import { test, expect } from "./fixtures";

// UX round 21: the mock view's feature list claimed "✓ configurable latency" (the CLI genuinely
// supports `truspec mock --delay <ms>`, per packages/core/src/mock/server.ts's `delayMs` option),
// but there was no way to configure it from the UI at all — `mockStart` only ever sent `spec` and
// `port`, and the web server's own `/api/mock/start` handler didn't accept or forward a delay
// either. A feature the UI advertises but can't actually reach.
test.describe("mock server latency control (real browser)", () => {
  test("setting a latency actually delays mock responses, and the running state reflects it", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });

    await page.selectOption("select[aria-label='OpenAPI spec']", "openapi.yaml");
    await page.locator(".nav-btn", { hasText: "mock" }).click();

    await page.fill(".mock-delay-field input", "200");
    await expect(page.locator(".mock-cmd code")).toContainText("--delay 200");

    await page.locator(".btn.run", { hasText: "start" }).click();
    await expect(page.locator(".mock-state")).toHaveText("running");
    await expect(page.locator(".mock-port", { hasText: "delay" })).toHaveText("200ms delay");

    const port = await page.locator(".mock-port .n").first().textContent();
    const start = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/posts`);
    const elapsed = Date.now() - start;
    expect(res.status).toBeLessThan(500);
    expect(elapsed).toBeGreaterThanOrEqual(180); // 200ms delay, small tolerance for scheduling jitter

    await page.locator(".btn.run", { hasText: "stop" }).click();
    await expect(page.locator(".mock-state")).toHaveText("stopped");
  });
});
