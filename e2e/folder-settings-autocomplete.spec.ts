import { test, expect } from "./fixtures";

// UX round 20: rounds 8/16 gave request-level headers/auth fields {{var}} autocomplete, but
// FolderSettingsModal's base-url/headers/auth fields — which inherit down to every request in the
// folder, and are just as likely to reference a variable (the base-url field's own placeholder
// literally reads "base url, e.g. {{baseUrl}}") — never got the same `envVarNames` prop threaded
// in, so they stayed plain, suggestion-less inputs.
test.describe("{{var}} autocomplete in folder settings (real browser)", () => {
  test("the base url and headers value fields offer the same {{var}} autocomplete as a request", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });

    await page.click(".new-folder");
    await page.fill(".modal input.kv-input", "widgets");
    await page.click(".modal-actions .btn.run");
    await page.waitForTimeout(500);

    await page.locator(".folder-row", { hasText: "widgets" }).click({ button: "right" });
    await page.locator(".context-menu-item", { hasText: "settings" }).click();

    const baseUrlInput = page.locator("input.path-input").nth(1);
    await baseUrlInput.click();
    await expect(baseUrlInput).toBeFocused();
    await baseUrlInput.pressSequentially("{{ba");
    await expect(page.locator(".var-suggest-item")).toHaveText(["{{baseUrl}}"]);
    // keyboard selection (Enter), not a mouse click on the position:fixed dropdown — avoids
    // flakiness from the menu's rect being recomputed on a modal's own layout/scroll timing.
    await baseUrlInput.press("Enter");
    await expect(baseUrlInput).toHaveValue("{{baseUrl}}");

    await page.click(".editable-kv-add");
    const headerValue = page.locator(".editable-kv-value");
    await headerValue.click();
    await expect(headerValue).toBeFocused();
    await headerValue.pressSequentially("{{ba");
    await expect(page.locator(".var-suggest-item")).toHaveText(["{{baseUrl}}"]);
  });
});
