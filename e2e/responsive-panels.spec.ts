import { test, expect } from "./fixtures";

// UX round 30: three real layout defects visible at default and narrow widths.
//  - the sidebar's four action buttons were a non-wrapping flex row, so "export" was clipped off
//    the right edge of the 270px sidebar at the DEFAULT width;
//  - the workspace grid's floor (270 + 500 + 340) exceeded a 900px window, so `.workspace` itself
//    scrolled and the spec rail was cut off mid-word with no affordance to reach the rest;
//  - `.req-top` did not wrap, so the URL — the single most important field — was squeezed to a
//    ~40px stub while the action buttons kept their full width.
test.describe("responsive panels (real browser)", () => {
  test("every sidebar action is fully inside the sidebar at the default width", async ({ app, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });

    const sidebar = (await page.locator(".sidebar").boundingBox())!;
    for (const label of ["+ folder", "+ new", "+ yaml", "⇩ export"]) {
      const box = (await page.locator(".newreq", { hasText: label }).boundingBox())!;
      expect(box.x + box.width, label).toBeLessThanOrEqual(sidebar.x + sidebar.width + 1);
    }
  });

  test("the spec rail gives way instead of being clipped when the window cannot hold it", async ({ app, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await expect(page.locator(".rail")).toBeVisible();

    await page.setViewportSize({ width: 900, height: 800 });
    await expect(page.locator(".rail")).toHaveCount(0);
    // Nothing overflows: the workspace fits the window rather than scrolling sideways.
    const overflow = await page.locator(".workspace").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // The same information is still reachable through the spec view.
    await page.locator(".nav-btn", { hasText: "spec" }).click();
    await expect(page.locator(".main")).toContainText("coverage", { ignoreCase: true });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(".nav-btn", { hasText: "workspace" }).click();
    await expect(page.locator(".rail")).toBeVisible();
  });

  test("the rail can be hidden by hand, and the choice survives a reload", async ({ app, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await expect(page.locator(".rail")).toBeVisible();

    await page.locator('button[aria-label="hide spec panel"]').click();
    await expect(page.locator(".rail")).toHaveCount(0);

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".rail")).toHaveCount(0);

    await page.locator('button[aria-label="show spec panel"]').click();
    await expect(page.locator(".rail")).toBeVisible();
  });

  test("the URL field stays readable at a narrow width; the buttons wrap instead", async ({ app, page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();

    const url = (await page.locator(".url-input").boundingBox())!;
    expect(url.width).toBeGreaterThan(200);
    const send = (await page.locator(".btn.run", { hasText: "send" }).boundingBox())!;
    // The send button moved onto its own line rather than stealing width from the URL.
    expect(send.y).toBeGreaterThan(url.y + url.height / 2);
    expect(send.x + send.width).toBeLessThanOrEqual(900);
  });
});
