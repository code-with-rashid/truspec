import { test, expect } from "./fixtures";

// UX round 34: a declared secret with no value surfaced only in the status bar AFTER a run had
// already failed on it. You could add a secret, save, run, and learn from a post-mortem message
// that nothing supplies it. Status is now shown up front, and never the value.
test.describe("secret resolution status (real browser)", () => {
  test("an unresolved secret is flagged next to the environment picker before any run", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    const warn = page.locator(".env-warn");
    await expect(warn).toBeVisible();
    await expect(warn).toContainText("1 unset");
    await expect(warn).toHaveAttribute("title", /tspecE2eToken/);
  });

  test("clicking the warning opens the environment manager", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".env-warn").click();
    await expect(page.locator(".modal-head")).toContainText("environments");
    await expect(page.locator(".env-list-row .badge-stale")).toContainText("1 unset");
  });

  test("editing an environment shows each secret's status, and never a value", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator('button[aria-label="manage environments"]').click();
    await page.locator('button[aria-label="edit environment \\"local\\""]').click();

    const chip = page.locator(".captured-chip", { hasText: "tspecE2eToken" });
    await expect(chip).toContainText("not set");
    await expect(chip).toHaveClass(/unset/);
    // The whole point: status, never the value.
    await expect(page.locator(".modal-body")).not.toContainText("=");
  });
});
