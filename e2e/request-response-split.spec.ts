import { test, expect } from "./fixtures";

// UX round 1: the request/response area used to be one scrolling column with the response
// pinned to the bottom of a `min-height:100%` flex container (`margin-top:auto`). For a request
// whose active tab has little content (e.g. a GET with no params), that left a dead-space gap
// and pushed the response — the single most important part of an API client — below the fold.
// It's now a resizable, always-visible docked split, matching Postman/Bruno's response pane.
test.describe("request/response split (real browser)", () => {
  test("the response dock is visible without scrolling, even for a request with an empty params tab", async ({ app, page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    const box = await page.locator(".response-head").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(720);
  });

  test("dragging the response resize handle changes the response pane's height", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.waitForSelector(".response");
    const before = await page.locator(".response").boundingBox();
    const handle = page.locator(".resize-handle.horiz");
    const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y - 150, { steps: 5 });
    await page.mouse.up();
    const after = await page.locator(".response").boundingBox();
    expect(after!.height).toBeGreaterThan(before!.height + 100);
  });
});
