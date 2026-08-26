import { test, expect } from "./fixtures";

// UX round 16: rounds 7-10 extended {{var}} autocomplete to the URL, params/headers, and form-body
// value fields — every other place a user types a variable reference. The auth editor's
// token/username/password/apikey-value fields were the one place left out, despite being the most
// likely of all of them to hold a {{var}} reference (CLAUDE.md's own example is
// `auth: { type: bearer, token: "{{token}}" }`) — they were still plain <input>s with no
// suggestions.
test.describe("{{var}} autocomplete in the auth editor (real browser)", () => {
  test("the bearer token field offers the same {{var}} autocomplete as the URL bar", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "auth" }).click();
    await page.selectOption("select[aria-label='auth scheme']", "bearer");

    const tokenInput = page.locator(".kv-input");
    await tokenInput.click();
    await expect(tokenInput).toBeFocused();
    await tokenInput.pressSequentially("{{ba");
    await expect(page.locator(".var-suggest-item")).toHaveText(["{{baseUrl}}"]);

    await page.click(".var-suggest-item");
    await expect(tokenInput).toHaveValue("{{baseUrl}}");
  });

  test("the apikey name column has no autocomplete (plain input)", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "auth" }).click();
    await page.selectOption("select[aria-label='auth scheme']", "apikey");

    const nameInput = page.locator(".kv-input").first();
    await nameInput.click();
    await nameInput.pressSequentially("{{ba");
    await expect(page.locator(".var-suggest-item")).toHaveCount(0);
  });

  test("the apikey value column offers {{var}} autocomplete", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "auth" }).click();
    await page.selectOption("select[aria-label='auth scheme']", "apikey");

    const valueInput = page.locator(".kv-input").nth(1);
    await valueInput.click();
    await expect(valueInput).toBeFocused();
    await valueInput.pressSequentially("{{ba");
    await expect(page.locator(".var-suggest-item")).toHaveText(["{{baseUrl}}"]);
  });
});
