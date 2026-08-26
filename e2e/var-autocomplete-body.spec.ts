import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// UX round 10: rounds 7-8 added {{var}} autocomplete to the URL bar and params/headers values.
// This closes the last gap in EditableKV's reach — the form-encoded body type (BodyEditor's
// "form" body, which reuses the same EditableKV component).
test.describe("{{var}} autocomplete in a form body (real browser)", () => {
  test("switching a request's body to form-encoded offers {{var}} autocomplete in the value column", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "body" }).click();
    await page.selectOption('[aria-label="body type"]', "form");
    await page.click(".editable-kv-add");

    const valueInput = page.locator(".editable-kv-value");
    await valueInput.click();
    await valueInput.pressSequentially("{{ba");
    await expect(page.locator(".var-suggest-item")).toHaveText(["{{baseUrl}}"]);
  });

  // Found while writing the test above: a form-body row vanished the instant it was added, before
  // any typing was possible. BodyEditor derived its rows straight from body.content on every
  // render with no local buffer (unlike RequestWorkspace's query/header rows) — the freshly-added
  // row's blank key got dropped by rowsToObject() on the very next render, in the same tick as the
  // click. Fixed by giving BodyEditor its own buffered row state for the form type, mirroring the
  // existing query/header pattern.
  test("a form field survives being added, typed into, and saved (not dropped on the next render)", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "body" }).click();
    await page.selectOption('[aria-label="body type"]', "form");
    await page.click(".editable-kv-add");

    await page.fill(".editable-kv-key", "field1");
    await page.fill(".editable-kv-value", "hello");
    await expect(page.locator(".editable-kv-key")).toHaveValue("field1");
    await expect(page.locator(".editable-kv-value")).toHaveValue("hello");

    await page.click(".dirty-bar .btn.run");
    await page.waitForTimeout(500);
    const content = readFileSync(join(app.dir, "get.tspec.yaml"), "utf8");
    expect(content).toContain("field1");
    expect(content).toContain("hello");
  });
});
