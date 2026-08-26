import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// UX round 17: the script tab was read-only — a <pre> dump of the pre/post script text if one
// already existed, with no way to add, edit, or remove one from the UI at all. Adding a script
// (or fixing a typo in one) required knowing to open the raw YAML editor and hand-write the
// `script:` block yourself, with zero on-screen hint that was even possible. Matches the same
// "was read-only, now inline-editable" gap round 3 fixed for assertions.
test.describe("inline script editor (real browser)", () => {
  test("a pre-request script can be added, edited, saved, and removed", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "script" }).click();

    // the fixture's request has no script — both "add" affordances show, no textarea yet
    await expect(page.locator(".script-text")).toHaveCount(0);
    const addPre = page.locator("button", { hasText: "+ add pre-request script" });
    await expect(addPre).toBeVisible();

    await addPre.click();
    const preText = page.locator(".script-text");
    await expect(preText).toBeVisible();
    await preText.fill('tr.set("nonce", tr.uuid())');

    await page.click(".dirty-bar .btn.run");
    await page.waitForTimeout(500);
    await expect(page.locator(".dirty-bar")).toHaveCount(0);

    const content = readFileSync(join(app.dir, "get.tspec.yaml"), "utf8");
    expect(content).toContain("script:");
    expect(content).toContain("tr.uuid()");

    // remove it and confirm it round-trips back out
    await page.locator("button", { hasText: "remove" }).click();
    await page.click(".dirty-bar .btn.run");
    await page.waitForTimeout(500);
    const after = readFileSync(join(app.dir, "get.tspec.yaml"), "utf8");
    expect(after).not.toContain("script:");
  });
});
