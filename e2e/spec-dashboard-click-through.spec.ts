import { test, expect } from "./fixtures";

// UX round 27: the spec dashboard's operations table and drift "what to resolve" lists were pure
// text — a covered operation, or a "stale"/"changed" drift entry, both correspond to a specific
// request in the collection (matched by the same spec-operation ref the request's own `spec:`
// block resolves to), but there was no way to jump to it. The user had to manually search the
// sidebar tree for whichever request the dashboard was talking about.
test.describe("spec dashboard click-through (real browser)", () => {
  test("a covered operation row opens the request that covers it", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.selectOption("select[aria-label='OpenAPI spec']", "openapi.yaml");
    await page.locator(".nav-btn", { hasText: "spec" }).click();

    const coveredRow = page.locator(".op-row").filter({ has: page.locator(".op-badge", { hasText: /^tested$/ }) }).first();
    await expect(coveredRow).toHaveClass(/op-row-link/);
    await coveredRow.click();

    await expect(page.locator(".nav-btn.active")).toHaveText("workspace");
    await expect(page.locator(".tab-strip-item", { hasText: "Get pet" })).toHaveCount(1);
  });

  test("an uncovered operation row is not clickable", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.selectOption("select[aria-label='OpenAPI spec']", "openapi.yaml");
    await page.locator(".nav-btn", { hasText: "spec" }).click();

    const uncoveredRow = page.locator(".op-row").filter({ has: page.locator(".op-badge", { hasText: /^untested$/ }) }).first();
    await expect(uncoveredRow).not.toHaveClass(/op-row-link/);
  });
});
