import { test, expect } from "./fixtures";

// UX round 8: round 7 added {{var}} autocomplete to the URL input only. Params and headers are
// edited through the same EditableKV component, so this extends the same VarAwareInput to their
// value columns (not keys — a variable reference belongs in a value, not a header/param name).
test.describe("{{var}} autocomplete in params/headers (real browser)", () => {
  test("the headers value column offers the same {{var}} autocomplete as the URL bar", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "headers" }).click();
    await page.click(".editable-kv-add");

    const valueInput = page.locator(".editable-kv-value");
    await valueInput.click();
    await valueInput.pressSequentially("{{ba");
    await expect(page.locator(".var-suggest-item")).toHaveText(["{{baseUrl}}"]);

    await page.click(".var-suggest-item");
    await expect(valueInput).toHaveValue("{{baseUrl}}");
  });

  test("the key column has no autocomplete (plain input)", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "headers" }).click();
    await page.click(".editable-kv-add");

    const keyInput = page.locator(".editable-kv-key");
    await keyInput.click();
    await keyInput.pressSequentially("{{ba");
    await expect(page.locator(".var-suggest-item")).toHaveCount(0);
  });
});
