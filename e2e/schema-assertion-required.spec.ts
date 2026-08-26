import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// UX round 23: the `schema` assertion's inline editor exposed `status` and `contentType` but not
// `required` — a real, documented flag (packages/core/src/runner/assertions.ts) that changes
// whether a status the linked spec doesn't document is silently skipped (default) or fails outright
// (`required: true`). A meaningful strictness toggle, unreachable without the raw YAML editor.
test.describe("schema assertion 'required' toggle (real browser)", () => {
  test("checking required saves required: true, and the value round-trips on reload", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "assertions" }).click();
    await page.click(".editable-kv-add");

    const row = page.locator(".assert-row").last();
    await row.locator(".assert-type-select").selectOption("schema");
    const required = row.locator(".assert-required input");
    await expect(required).not.toBeChecked();
    await required.check();

    await page.click(".dirty-bar .btn.run");
    await page.waitForTimeout(500);
    await expect(page.locator(".dirty-bar")).toHaveCount(0);

    const content = readFileSync(join(app.dir, "get.tspec.yaml"), "utf8");
    expect(content).toContain("type: schema");
    expect(content).toContain("required: true");

    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "assertions" }).click();
    await expect(page.locator(".assert-row").last().locator(".assert-required input")).toBeChecked();
  });
});
