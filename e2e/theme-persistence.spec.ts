import { test, expect } from "./fixtures";

// UX round 9: the theme reset to dark on every load — no memory of a prior toggle, and no regard
// for the OS/browser's own light/dark preference either. Postman/Bruno both remember an explicit
// choice and otherwise default to the system preference.
test.describe("theme persistence + system default (real browser)", () => {
  test("toggling the theme persists it across a reload", async ({ app, page }) => {
    await page.emulateMedia({ colorScheme: "dark" }); // pin the starting point so the toggle's direction is known
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");

    await page.click('[title="toggle theme"]');
    const stored = await page.evaluate(() => localStorage.getItem("truspec.theme"));
    expect(stored).toBe("light");

    await page.reload({ waitUntil: "networkidle" });
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe("light");
  });

  test("with no stored preference, the app follows the OS/browser's prefers-color-scheme", async ({ app, page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe("light");
  });
});
