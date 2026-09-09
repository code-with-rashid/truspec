import { test, expect } from "./fixtures";

// UX round 31: reading a response was only half the job — the other half is turning what you found
// into an assertion, which every other client leaves you to do by hand (read the body, retype the
// path, hope you got it right). The filter box evaluates the REAL JSONPath engine against the REAL
// response and offers one click to assert or capture the match.
test.describe("response filter (real browser)", () => {
  test.beforeEach(async ({ app, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".btn.run", { hasText: "send" }).click();
    await expect(page.locator(".response-body")).toBeVisible();
  });

  test("a JSONPath filter reports what it selects, and no match when it selects nothing", async ({ page }) => {
    await page.fill(".body-filter", "$.name");
    await expect(page.locator(".path-result")).toContainText("1 match");
    await expect(page.locator(".path-value")).toContainText("Rex");

    await page.fill(".body-filter", "$.nope");
    await expect(page.locator(".path-result")).toContainText("no match");
  });

  test("a matched path can be added as an assertion in one click", async ({ page }) => {
    await page.fill(".body-filter", "$.name");
    await page.locator(".add-assert").click();

    // The count on the tab reflects the draft, i.e. the assertion really landed on it.
    await expect(page.locator(".tab", { hasText: "assertions" })).toContainText("2");
    await page.locator(".tab", { hasText: "assertions" }).click();
    // The path lives in an input's value, not in text.
    await expect(page.locator('.assert-row input[placeholder="$.jsonpath"]')).toHaveValue("$.name");
  });

  test("a matched path can be captured into a named variable", async ({ page }) => {
    await page.fill(".body-filter", "$.id");
    await page.locator(".add-capture").click();
    // The name is pre-filled from the path's last segment.
    await expect(page.locator('input[aria-label="capture variable name"]')).toHaveValue("id");
    await page.locator(".capture-save").click();

    await expect(page.locator(".tab", { hasText: "capture" })).toContainText("1");
    await page.locator(".tab", { hasText: "capture" }).click();
    const row = page.locator(".tabpanel input").first();
    await expect(row).toHaveValue("id");
  });

  test("a plain-text filter narrows the body to matching lines", async ({ page }) => {
    await page.fill(".body-filter", "name");
    await expect(page.locator(".path-result")).toContainText("of");
    await expect(page.locator(".body")).toContainText("Rex");
    await expect(page.locator(".body")).not.toContainText('"id"');
  });

  test("pretty and wrap are toggles, and raw shows the unformatted body", async ({ page }) => {
    const pretty = page.locator('button[aria-pressed]', { hasText: "pretty" });
    await expect(pretty).toHaveAttribute("aria-pressed", "true");
    await pretty.click();
    await expect(pretty).toHaveAttribute("aria-pressed", "false");
    // The mock returns compact JSON, so raw is a single line.
    await expect(page.locator(".body")).toContainText('{"id":1,"name":"Rex"}');
  });
});
