import { test, expect } from "./fixtures";

// UX round 26: the tab strip had no bulk-close mechanism at all — no context menu, no "close
// others"/"close all", not even a native browser right-click menu suppressed in its favor (it just
// fell through to the browser's own, breaking the native-app feel). Every tabbed editor (VS Code,
// Chrome itself, Postman, Bruno) offers this once you have more than a couple of tabs open. Bulk
// actions only ever drop *clean* tabs — a dirty one is silently left open rather than needing its
// own bulk confirm-dialog flow, so nothing unsaved is ever discarded by a bulk close.
test.describe("tab strip context menu (real browser)", () => {
  test("right-clicking a tab offers close/close others/close all", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();

    await page.locator(".tab-strip-item").first().click({ button: "right" });
    const menu = page.locator(".context-menu");
    await expect(menu.locator(".context-menu-item", { hasText: "close others" })).toBeVisible();
    await expect(menu.locator(".context-menu-item", { hasText: "close all" })).toBeVisible();
  });

  test("a dirty tab survives 'close all' (bulk close never discards unsaved edits)", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "headers" }).click();
    await page.click(".editable-kv-add");
    await expect(page.locator(".tab-strip-dot")).toHaveCount(1);

    await page.locator(".tab-strip-item").first().click({ button: "right" });
    await page.locator(".context-menu-item", { hasText: "close all" }).click();

    await expect(page.locator(".tab-strip-item")).toHaveCount(1);
    await expect(page.locator(".tab-strip-dot")).toHaveCount(1);
  });
});
