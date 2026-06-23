import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";

// Guards the accessibility fixes (BUG-P: labels/heading/landmark; color-contrast raised to WCAG AA).
// Asserts ZERO axe violations on the main view, the editor, and in light theme.
const scan = (page: import("@playwright/test").Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

test.describe("accessibility (axe-core)", () => {
  test("main view has no WCAG 2 A/AA violations", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.waitForSelector(".rname");
    const { violations } = await scan(page);
    expect(violations, JSON.stringify(violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
  });

  test("editor view has no WCAG 2 A/AA violations (labeled controls)", async ({ app, page }) => {
    await page.goto(`${app.url}/?new=1`, { waitUntil: "networkidle" });
    await page.waitForSelector(".editor .editor-text");
    const { violations } = await scan(page);
    expect(violations, JSON.stringify(violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
  });

  test("light theme has no WCAG 2 A/AA violations (contrast)", async ({ app, page }) => {
    await page.goto(`${app.url}/?theme=light`, { waitUntil: "networkidle" });
    await page.waitForSelector(".rname");
    const { violations } = await scan(page);
    expect(violations, JSON.stringify(violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
  });

  test("the spec dropdown and editor fields have accessible names", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await expect(page.locator(".spec-pick select")).toHaveAttribute("aria-label", "OpenAPI spec");
    await expect(page.locator("h1")).toHaveCount(1);
  });
});
