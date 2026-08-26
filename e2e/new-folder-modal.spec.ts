import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// UX round 13: "new folder" used to be a bare, unlabeled inline row in the sidebar (just a
// placeholder for guidance, no heading, no context about where it lands) — inconsistent with
// every other creation flow in the app, which already uses the shared modal chrome (new request,
// environments, folder settings). This gives it the same modal, with a clear "name" label and a
// hint showing exactly what path gets created — including the parent folder when opened from a
// folder's own "new folder" context-menu action.
test.describe("guided new-folder modal (real browser)", () => {
  test("creating a top-level folder writes it and shows it in the sidebar", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click(".new-folder");
    await page.fill(".modal input.kv-input", "widgets");
    await page.click(".modal-actions .btn.run");
    await page.waitForTimeout(500);

    expect(existsSync(join(app.dir, "widgets"))).toBe(true);
    await expect(page.locator(".folder-name", { hasText: "widgets" })).toHaveCount(1);
  });

  test("creating a folder from a folder's context menu nests it and shows the resulting path", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });

    // this fixture's workspace starts with no folders — create one to nest inside
    await page.click(".new-folder");
    await page.fill(".modal input.kv-input", "posts");
    await page.click(".modal-actions .btn.run");
    await page.waitForTimeout(500);

    await page.locator(".folder-row", { hasText: "posts" }).click({ button: "right" });
    await page.locator(".context-menu-item", { hasText: "new folder" }).click();

    await expect(page.locator(".modal-body")).toContainText("inside posts");
    await page.fill(".modal input.kv-input", "nested");
    await expect(page.locator(".modal-body")).toContainText("posts/nested");
    await page.click(".modal-actions .btn.run");
    await page.waitForTimeout(500);

    expect(existsSync(join(app.dir, "posts", "nested"))).toBe(true);
  });
});
