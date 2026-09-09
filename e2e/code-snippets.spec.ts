import { test, expect } from "./fixtures";

// UX round 5: Postman and Bruno both let you copy a request as a snippet — useful for bug reports,
// docs, and pasting into a terminal to reproduce something outside the app. TruSpec had no
// equivalent at all; it now generates for 17 clients/languages through the real engine, so the
// snippet matches what a run would actually send.
test.describe("code snippets (real browser)", () => {
  test("the code panel generates curl and copies it", async ({ app, page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();

    await page.click(".curl-btn");
    await expect(page.locator(".code-out")).toContainText("curl -X GET");
    // Generation goes through the real engine, so the active environment's baseUrl is substituted
    // — the whole reason this replaced the old client-side builder, which could not resolve it.
    await expect(page.locator(".code-out")).toContainText("/pets/1");
    await expect(page.locator(".code-out")).not.toContainText("{{baseUrl}}");

    await page.click(".code-modal .btn.ghost.small");
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain("curl -X GET");
  });

  test("switching language re-renders the snippet in that language", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.click(".curl-btn");

    await page.selectOption('select[aria-label="snippet language"]', "python-requests");
    await expect(page.locator(".code-out")).toContainText("import requests");
  });
});
