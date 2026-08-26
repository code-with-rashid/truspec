import { test, expect } from "./fixtures";

// UX round 5: Postman and Bruno both let you copy a request as a curl command — useful for bug
// reports, docs, and pasting into a terminal to reproduce something outside the app. TruSpec had
// no equivalent at all.
test.describe("copy as curl (real browser)", () => {
  test("the curl button copies a well-formed curl command for the current request", async ({ app, page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();

    await page.click(".curl-btn");
    await expect(page.locator(".curl-btn")).toHaveText("copied ✓");

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain("curl -X GET");
    expect(clipboard).toContain("{{baseUrl}}/pets/1");
  });
});
