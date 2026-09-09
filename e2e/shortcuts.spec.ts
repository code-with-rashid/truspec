import { test, expect } from "./fixtures";

// UX round 33: the app bound send and save inside the request view, so they only fired while focus
// happened to be there — pressing them after clicking the sidebar did nothing. And it advertised
// none of its shortcuts, which makes an unlisted shortcut one only its author uses.
test.describe("keyboard shortcuts (real browser)", () => {
  test("? opens a shortcut reference, and typing a ? in a field does not", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });

    await page.keyboard.press("?");
    await expect(page.locator(".modal-head")).toContainText("keyboard shortcuts");
    await page.keyboard.press("Escape");
    await expect(page.locator(".modal-head")).toHaveCount(0);

    await page.fill(".tree-search input", "?");
    await expect(page.locator(".modal-head")).toHaveCount(0);
    await expect(page.locator(".tree-search input")).toHaveValue("?");
  });

  test("save works from outside the request view", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.fill(".url-input", "{{baseUrl}}/pets/2");
    await expect(page.locator(".tab-strip-dot")).toBeVisible();

    // Focus somewhere outside the request pane, then save.
    await page.locator(".tree-search input").click();
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.locator(".tab-strip-dot")).toHaveCount(0);
  });

  test("send works from outside the request view", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tree-search input").click();
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.locator(".response-body")).toBeVisible();
  });

  test("mod+alt+arrows move between tabs and mod+alt+w closes one", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".req").first().click();
    await expect(page.locator(".tab-strip-item")).toHaveCount(2);

    // Compare by path (the button's title), which is unique and stable — unlike the displayed
    // name, which for the XSS-probe fixture is a long HTML-ish string.
    const activePath = () => page.locator(".tab-strip-item.active .tab-strip-main").getAttribute("title");
    const first = await activePath();
    await page.keyboard.press("ControlOrMeta+Alt+ArrowLeft");
    expect(await activePath()).not.toBe(first);
    await page.keyboard.press("ControlOrMeta+Alt+ArrowRight");
    expect(await activePath()).toBe(first);

    await page.keyboard.press("ControlOrMeta+Alt+w");
    await expect(page.locator(".tab-strip-item")).toHaveCount(1);
  });

  test("the palette offers the actions that used to be buttons only", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.keyboard.press("ControlOrMeta+k");
    await page.fill(".palette-input", "shortcut");
    await expect(page.locator(".palette-cmd")).toContainText("keyboard shortcuts");
    await page.locator(".palette-cmd").first().click();
    await expect(page.locator(".modal-head")).toContainText("keyboard shortcuts");
  });
});
