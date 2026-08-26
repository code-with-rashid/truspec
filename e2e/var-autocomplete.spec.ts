import { test, expect } from "./fixtures";

// UX round 7: typing `{{` in the URL bar used to do nothing beyond inserting plain text — Postman
// and Bruno both offer environment-variable autocomplete at that point. The suggestion dropdown
// is `position: fixed` (measured from the input's own bounding rect) specifically because the URL
// bar's rounded-corner `overflow: hidden` would otherwise clip an absolutely-positioned dropdown
// nested inside it — confirmed by inspecting the live DOM before landing on this approach.
test.describe("{{var}} autocomplete (real browser)", () => {
  test("typing {{ in the URL input shows environment variable suggestions, and selecting one inserts it", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();

    await page.click(".url-input");
    await page.locator(".url-input").press("End");
    await page.keyboard.type("/{{ba");
    await expect(page.locator(".var-suggest-item")).toHaveText(["{{baseUrl}}"]);

    await page.click(".var-suggest-item");
    await expect(page.locator(".url-input")).toHaveValue("{{baseUrl}}/pets/1/{{baseUrl}}");
  });

  test("a partial that matches no declared variable shows no suggestions", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.click(".url-input");
    await page.locator(".url-input").press("End");
    await page.keyboard.type("/{{zzz");
    await expect(page.locator(".var-suggest-item")).toHaveCount(0);
  });
});
