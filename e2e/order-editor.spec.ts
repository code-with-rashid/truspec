import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// UX round 22: a request's `order` field (run order within a collection — the companion to
// round 18's `capture`, both documented together under CLAUDE.md's "Capture & chaining" section
// for controlling a login-then-use-token style chain without renaming files) had zero UI
// presence — not editable, not even visible. Matches the "was entirely absent, now editable" gap
// rounds 3/17/18/19 fixed elsewhere.
test.describe("inline order editor (real browser)", () => {
  test("an explicit run order can be set, edited, saved, and unset", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();

    // the fixture's request has no explicit order — only the "+ order" affordance
    await expect(page.locator(".order-field")).toHaveCount(0);
    const addBtn = page.locator("button.order-add");
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    const orderInput = page.locator(".order-field input");
    await expect(orderInput).toBeVisible();
    await expect(orderInput).toHaveValue("0");
    await orderInput.fill("3");

    await page.click(".dirty-bar .btn.run");
    await page.waitForTimeout(500);
    await expect(page.locator(".dirty-bar")).toHaveCount(0);

    const content = readFileSync(join(app.dir, "get.tspec.yaml"), "utf8");
    expect(content).toContain("order: 3");

    // unset it and confirm it round-trips back out
    await page.locator(".order-remove").click();
    await page.click(".dirty-bar .btn.run");
    await page.waitForTimeout(500);
    const after = readFileSync(join(app.dir, "get.tspec.yaml"), "utf8");
    expect(after).not.toContain("order:");
  });
});
