import { test, expect } from "./fixtures";

// UX round 24: the command palette's own placeholder text has always read "jump to a request,
// run, or view…" — but the implementation only ever searched requests. There was no way to jump to
// a view (spec/mock/flow) or run the whole collection from the palette, despite it advertising
// both. Added a small set of command entries (view jumps + run-all) shown above request matches.
test.describe("command palette actions (real browser)", () => {
  test("typing a view name offers a jump command, and selecting it switches views", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.keyboard.press("Control+k");
    await page.locator(".palette-input").fill("spec");

    const cmd = page.locator(".palette-cmd", { hasText: "go to spec view" });
    await expect(cmd).toBeVisible();
    await cmd.click();

    await expect(page.locator(".palette-overlay")).toHaveCount(0);
    await expect(page.locator(".nav-btn.active")).toHaveText("spec");
  });

  test("the 'run all requests' command runs the collection", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.keyboard.press("Control+k");
    await page.locator(".palette-input").fill("run all");

    const cmd = page.locator(".palette-cmd", { hasText: "run all requests" });
    await expect(cmd).toBeVisible();
    await cmd.click();

    await expect(page.locator(".palette-overlay")).toHaveCount(0);
    // a completed run switches the rail to its "runs" tab (doRun's own post-run effect) — proof
    // the command actually invoked the run, not just closed the palette.
    await expect(page.locator(".rail-tab.active")).toHaveText("runs");
  });
});
