import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// UX round 25: duplicating a request only ever refreshed the sidebar tree silently — the new
// "Name (copy)" file existed on disk, but nothing in the UI pointed at it. The user had to scroll
// the (possibly long, possibly collapsed) sidebar tree to find their own copy and open it
// themselves. Postman and Bruno both land you on the new copy immediately, ready to edit.
test.describe("duplicating a request opens the copy (real browser)", () => {
  test("the duplicate is opened as a tab, not just added to the tree", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });

    const row = page.locator(".req", { hasText: "Get pet" });
    await row.hover();
    await row.locator('[title="duplicate request"]').click();
    await page.waitForTimeout(500);

    await expect(page.locator(".tab-strip-item", { hasText: "Get pet (copy)" })).toHaveCount(1);
    await expect(page.locator(".req-name", { hasText: "Get pet (copy)" })).toHaveCount(1);

    const files = readdirSync(app.dir).filter((f) => f.endsWith(".tspec.yaml"));
    expect(files.some((f) => f !== "get.tspec.yaml" && f !== "evil.tspec.yaml")).toBe(true);
  });
});
