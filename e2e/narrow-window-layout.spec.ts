import { test, expect } from "./fixtures";

// UX round 14: the top bar and status bar were a single flex row with every child pinned to
// `flex-shrink: 0` and no wrap — their combined intrinsic width (~1101px) never budged, so any
// window narrower than that made the WHOLE document scroll horizontally instead of the toolbar
// adapting. That hid primary navigation (the flow/spec/mock tabs) and the "run all" button off
// the right edge with no visual cue that scrolling further would reveal them — a real scenario
// for a desktop app resized into a split-screen or a smaller laptop. Both rows now wrap onto a
// second line instead, so nothing goes off-screen; only the sidebar/rail's own ~610px structural
// floor remains, which is expected for a three-pane layout and well below 1101px.
test.describe("narrow window layout (real browser)", () => {
  test("below the toolbar's old fixed-row width, nav and the run button wrap instead of scrolling off-screen", async ({ app, page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });

    const docWidths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(docWidths.scroll).toBeLessThanOrEqual(docWidths.client);

    const mockTab = page.locator(".nav-btn", { hasText: "mock" });
    const runAll = page.locator(".btn.run", { hasText: "run all" });
    await expect(mockTab).toBeVisible();
    await expect(runAll).toBeVisible();
    const mockBox = await mockTab.boundingBox();
    const runBox = await runAll.boundingBox();
    expect(mockBox!.x + mockBox!.width).toBeLessThanOrEqual(900);
    expect(runBox!.x + runBox!.width).toBeLessThanOrEqual(900);
  });

  test("at a typical desktop width the toolbar still renders as a single row (no regression)", async ({ app, page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });

    const topbarHeight = await page.locator(".topbar").evaluate((el) => el.getBoundingClientRect().height);
    expect(topbarHeight).toBeLessThan(65);
  });
});
