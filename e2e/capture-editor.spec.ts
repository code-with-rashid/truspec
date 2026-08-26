import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// UX round 18: `capture` (saving a response value into a variable for a later request — e.g. a
// login step capturing a token, one of CLAUDE.md's headline features, "Capture & chaining") had
// no UI at all. The app only ever showed captured *results* after a run; declaring what to
// capture required hand-writing the `capture:` block in the raw YAML editor. Matches the same
// "was entirely absent, now inline-editable" gap round 3 fixed for assertions.
test.describe("inline capture editor (real browser)", () => {
  test("a jsonpath capture can be added, saved, and removed", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "capture" }).click();

    // the fixture's request has no capture — no rows, just the "add" affordance
    await expect(page.locator(".assert-row")).toHaveCount(0);
    await page.click(".editable-kv-add");
    await expect(page.locator(".assert-row")).toHaveCount(1);

    const row = page.locator(".assert-row").first();
    await row.locator(".assert-name").fill("petName");
    await row.locator(".assert-value").fill("$.name");

    await page.click(".dirty-bar .btn.run");
    await page.waitForTimeout(500);
    await expect(page.locator(".dirty-bar")).toHaveCount(0);

    const content = readFileSync(join(app.dir, "get.tspec.yaml"), "utf8");
    expect(content).toContain("capture:");
    expect(content).toContain("petName");
    expect(content).toContain("$.name");

    // switching the source kind swaps the value field's placeholder/shape
    await row.locator(".assert-type-select").selectOption("header");
    await expect(row.locator(".assert-value")).toHaveAttribute("placeholder", "X-Request-Id");

    // remove the row and confirm it round-trips back out
    await row.locator(".row-action-btn.danger").click();
    await page.click(".dirty-bar .btn.run");
    await page.waitForTimeout(500);
    const after = readFileSync(join(app.dir, "get.tspec.yaml"), "utf8");
    expect(after).not.toContain("capture:");
  });
});
