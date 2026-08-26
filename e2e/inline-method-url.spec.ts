import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// UX round 2: method and URL used to be static text in the request bar — changing GET to POST or
// fixing a typo'd path required opening the raw YAML editor, even though every other field
// (params/headers/body/auth) was already inline-editable. Now the method is a real <select> and
// the URL a real <input>, matching Postman/Bruno's basic compose loop.
test.describe("inline method + URL editing (real browser)", () => {
  test("the method can be changed and the URL edited directly in the request bar, and both persist on save", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();

    await page.selectOption(".method-select", "POST");
    await expect(page.locator(".dirty-bar")).toHaveCount(1);
    await expect(page.locator(".url-bar .method-select")).toHaveClass(/m-POST/);

    await page.fill(".url-input", "{{baseUrl}}/pets/2");
    await page.click(".dirty-bar .btn.run");
    await page.waitForTimeout(500);
    await expect(page.locator(".dirty-bar")).toHaveCount(0);

    const content = readFileSync(join(app.dir, "get.tspec.yaml"), "utf8");
    expect(content).toContain("method: POST");
    expect(content).toContain("/pets/2");
  });

  test("pressing Enter in the URL input sends the request", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.click(".url-input");
    await page.keyboard.press("Enter");
    await expect(page.locator(".response-head .pill")).toHaveCount(1, { timeout: 5000 });
  });
});
