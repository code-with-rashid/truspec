import { test, expect } from "./fixtures";

// UX round 11: TruSpec had no persistent record of individually-sent requests — only the "runs"
// tab (a snapshot of the LAST result per request, overwritten on every send) and per-request
// results, neither of which is a chronological "what did I just send" log. Postman/Bruno both keep
// one. This adds a "history" rail tab, backed by localStorage (capped at 50 entries) so it
// survives a reload — a "run all" collection run intentionally does NOT get logged here, since
// that's what the existing "runs" tab is for.
test.describe("send history (real browser)", () => {
  test("sending a request logs it to history, which survives a reload and reopens the request on click", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.click(".req-top .btn.run"); // send (not the top-bar "run all", which is also `.btn.run`)
    await expect(page.locator(".response-head .pill")).toHaveCount(1, { timeout: 5000 });

    await page.locator(".rail-tab", { hasText: "history" }).click();
    await expect(page.locator(".rail-panel .rrow")).toHaveCount(1);
    await expect(page.locator(".rail-panel .rrow-name")).toHaveText("Get pet");

    // survives a reload (localStorage-backed)
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".rail-tab", { hasText: "history" }).click();
    await expect(page.locator(".rail-panel .rrow")).toHaveCount(1);

    // clicking it reopens the request as a tab
    await page.locator(".rail-panel .rrow").click();
    await expect(page.locator(".tab-strip-item", { hasText: "Get pet" })).toHaveCount(1);
  });

  test("running the whole collection does not add entries to history", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click(".btn.run:has-text('run all')");
    await page.waitForTimeout(500);

    await page.locator(".rail-tab", { hasText: "history" }).click();
    await expect(page.locator(".rail-panel .rrow")).toHaveCount(0);
  });
});
