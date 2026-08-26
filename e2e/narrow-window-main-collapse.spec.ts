import { test, expect } from "./fixtures";

// UX round 15: the 3-column workspace grid (sidebar / main / rail) used `minmax(0, 1fr)` for the
// main column — the actual request/response editor, the single most important part of the app.
// The sidebar (270px) and rail (340px) are both fixed-ish widths, so once the window narrowed
// below their combined ~620px, the main column shrank all the way to 0 width: not scrolled
// off-screen (which at least a user could scroll to reveal), but genuinely zero pixels wide and
// unusable, while the secondary sidebar and rail panels stayed fully visible at full size. That's
// backwards — the primary content should be the last thing to give up space, not the first. Giving
// `.main` a floor alone wasn't enough either: the URL bar's own internal flex row (method badge +
// url input + curl/save/send buttons) had the identical bug one level down — the url text input
// had `min-width: 0` and three fixed-width buttons ahead of it in the same row, so it shrank to a
// few px before `.main` itself ran out of room. Both now have real floors, and the workspace grid
// scrolls horizontally within itself (not the whole document, which round 14 already pinned the
// toolbar chrome to) when it doesn't fit.
test.describe("narrow window: main content never collapses to zero width (real browser)", () => {
  test("below the sidebar+rail floor, the URL input keeps a legible width instead of vanishing", async ({ app, page }) => {
    await page.setViewportSize({ width: 540, height: 800 });
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();

    const urlInput = page.locator(".url-input");
    await expect(urlInput).toBeVisible();
    const box = await urlInput.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(130);

    // the toolbar chrome (round 14) stays pinned — only the workspace grid itself scrolls.
    const doc = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(doc.scroll).toBeLessThanOrEqual(doc.client);
  });

  test("at a typical desktop width the workspace grid needs no internal scrolling (no regression)", async ({ app, page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });

    const ws = await page.evaluate(() => {
      const el = document.querySelector(".workspace");
      return el ? { scroll: el.scrollWidth, client: el.clientWidth } : null;
    });
    expect(ws!.scroll).toBeLessThanOrEqual(ws!.client);
  });
});
