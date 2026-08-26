import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// UX round 3: the assertions tab used to be read-only — the single most basic thing an API
// client lets you declare (what does a passing response look like) required a trip to the raw
// YAML editor, even though every other field was already inline-editable. It's now a row-based
// editor (add/remove/edit, per-type fields), matching Postman's "Tests" tab / Bruno's "Assert" tab.
test.describe("inline assertions editor (real browser)", () => {
  test("an assertion can be added, retyped, and removed, and the result persists on save", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "assertions" }).click();

    // starts with the fixture's one declared assertion (status equals 200)
    await expect(page.locator(".assert-row")).toHaveCount(1);

    await page.click(".editable-kv-add");
    await expect(page.locator(".assert-row")).toHaveCount(2);

    // retype the new row from its "status" default to "duration"
    await page.locator(".assert-row").nth(1).locator(".assert-type-select").selectOption("duration");
    await page.locator(".assert-row").nth(1).locator(".assert-value").fill("500");

    await page.click(".dirty-bar .btn.run");
    await page.waitForTimeout(500);
    await expect(page.locator(".dirty-bar")).toHaveCount(0);

    const content = readFileSync(join(app.dir, "get.tspec.yaml"), "utf8");
    expect(content).toContain("duration");
    expect(content).toContain("500");

    // remove the row that was just added and confirm it round-trips back out
    await page.locator(".assert-row").nth(1).locator(".row-action-btn.danger").click();
    await page.click(".dirty-bar .btn.run");
    await page.waitForTimeout(500);
    const after = readFileSync(join(app.dir, "get.tspec.yaml"), "utf8");
    expect(after).not.toContain("duration");
  });
});
