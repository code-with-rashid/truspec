import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// UX round 4: Postman/Bruno both let Ctrl/Cmd+Enter send from anywhere in the request builder
// (not just the URL bar) and Ctrl/Cmd+S save a dirty request, matching the raw YAML editor's
// existing Ctrl+Enter-to-save convention. The response body/headers also now have a one-click
// "copy" button, matching both tools' basic response-inspection affordances.
test.describe("keyboard shortcuts + copy (real browser)", () => {
  test("Ctrl/Cmd+Enter sends from anywhere in the request pane, not only the URL input", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "headers" }).click(); // focus something that is NOT the URL input
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".response-head .pill")).toHaveCount(1, { timeout: 5000 });
  });

  test("Ctrl/Cmd+S saves a dirty request from the inline workspace", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.fill(".url-input", "{{baseUrl}}/pets/9");
    await expect(page.locator(".dirty-bar")).toHaveCount(1);

    await page.keyboard.press("Control+s");
    await page.waitForTimeout(500);
    await expect(page.locator(".dirty-bar")).toHaveCount(0);

    const content = readFileSync(join(app.dir, "get.tspec.yaml"), "utf8");
    expect(content).toContain("/pets/9");
  });

  test("the response's copy button copies the visible body to the clipboard", async ({ app, page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.click(".btn.run"); // send
    await expect(page.locator(".response-head .pill")).toHaveCount(1, { timeout: 5000 });

    await page.click(".copy-btn");
    await expect(page.locator(".copy-btn")).toHaveText("copied ✓");
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('"id"');
  });
});
