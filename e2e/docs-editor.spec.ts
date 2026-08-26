import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// UX round 19: a request's `docs` field (a short description, per CLAUDE.md) was read-only — shown
// as a plain paragraph if one already existed, with no way to add or edit it from the UI. Matches
// the same "was read-only, now editable" gap rounds 3/17/18 fixed for assertions/script/capture.
test.describe("inline docs/description editor (real browser)", () => {
  test("a description can be added, saved, and removed", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();

    // the fixture's request has no docs — only the "add" affordance, no textarea yet
    await expect(page.locator(".docs-input")).toHaveCount(0);
    const addBtn = page.locator("button", { hasText: "+ add description" });
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    const docsInput = page.locator(".docs-input");
    await expect(docsInput).toBeVisible();
    await docsInput.fill("Fetches a single pet by its id.");

    await page.click(".dirty-bar .btn.run");
    await page.waitForTimeout(500);
    await expect(page.locator(".dirty-bar")).toHaveCount(0);

    const content = readFileSync(join(app.dir, "get.tspec.yaml"), "utf8");
    expect(content).toContain("docs: Fetches a single pet by its id.");

    // remove it and confirm it round-trips back out
    await page.locator(".docs-edit").locator("button", { hasText: "remove" }).click();
    await page.click(".dirty-bar .btn.run");
    await page.waitForTimeout(500);
    const after = readFileSync(join(app.dir, "get.tspec.yaml"), "utf8");
    expect(after).not.toContain("docs:");
  });
});
