import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";

// Guards the accessibility fixes (BUG-P: labels/heading/landmark; color-contrast raised to WCAG AA).
// Asserts ZERO axe violations on the main view, the editor, and in light theme.
/**
 * Wait for every running animation to finish before scanning.
 *
 * A modal fades in over 160ms, and an element mid-fade composites BOTH its text and its background
 * against whatever is behind it — axe then measures a contrast ratio that no user ever sees. Two
 * "violations" here were exactly that; settling first is the difference between auditing the UI
 * and auditing a transition.
 */
async function settle(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(
      document.getAnimations().map((a) => a.finished.catch(() => undefined)),
    );
  });
}

const scan = async (page: import("@playwright/test").Page) => {
  await settle(page);
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
};

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

  // Round 32: the audit only ever covered three screens, so every panel added since shipped
  // unscanned. Each of these opens a surface and asserts the same zero-violations bar.
  test("the code-snippet panel has no violations", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.click(".curl-btn");
    await page.waitForSelector(".code-out");
    const { violations } = await scan(page);
    expect(violations, JSON.stringify(violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
  });

  test("the response filter and its assert/capture affordances have no violations", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".btn.run", { hasText: "send" }).click();
    await page.waitForSelector(".response-body");
    await page.fill(".body-filter", "$.name");
    await page.waitForSelector(".add-assert");
    await page.click(".add-capture");
    await page.waitForSelector('input[aria-label="capture variable name"]');
    const { violations } = await scan(page);
    expect(violations, JSON.stringify(violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
  });

  test("every request tab — including the oauth2 and multipart editors — has no violations", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();

    await page.locator(".tab", { hasText: "auth" }).click();
    await page.selectOption('select[aria-label="auth scheme"]', "oauth2");
    await page.waitForSelector('select[aria-label="oauth2 grant"]');

    await page.locator(".tab", { hasText: "body" }).click();
    await page.selectOption('select[aria-label="body type"]', "multipart");
    await page.click("text=+ add part");
    await page.waitForSelector('select[aria-label="part kind"]');

    await page.locator(".tab", { hasText: "assertions" }).click();
    await page.waitForSelector('select[aria-label="assertion type"]');

    const { violations } = await scan(page);
    expect(violations, JSON.stringify(violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
  });

  test("the import dialog's pickers have no violations", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".nav-btn", { hasText: "flow" }).click();
    await page.locator(".btn", { hasText: "import collection" }).first().click();
    await page.waitForSelector("text=paste a curl command");
    const { violations } = await scan(page);
    expect(violations, JSON.stringify(violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
  });

  test("the narrow layout, where the rail gives way, has no violations", async ({ app, page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.waitForSelector(".rname");
    const { violations } = await scan(page);
    expect(violations, JSON.stringify(violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
  });
});
