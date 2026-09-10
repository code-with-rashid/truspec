import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

/**
 * The command palette is where people browse every action they can take, which makes it where they
 * learn the bindings. It listed "run the open request" with no sign that it is bound to ⌘↵ — while
 * carrying a `keyboard shortcuts` row two lines below, so the bindings existed and were advertised
 * everywhere except the one list people actually read.
 */
test.describe("the command palette shows an action's binding (real browser)", () => {
  test("puts the keys beside the actions that have them", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.keyboard.press("Control+k");
    await expect(page.locator(".palette-input")).toBeVisible();

    const cmd = (label: string) => page.locator(".palette-cmd", { hasText: label });
    // On this platform `modKey()` reports Ctrl; the label comes from the same registry the
    // window-level handler binds from, so the palette cannot advertise a binding the app lacks.
    await expect(cmd("run the open request").locator("kbd")).toHaveText(["Ctrl", "↵"]);
    await expect(cmd("save the open request").locator("kbd")).toHaveText(["Ctrl", "S"]);
    await expect(cmd("keyboard shortcuts").locator("kbd")).toHaveText(["?"]);
  });

  test("leaves actions with no binding unadorned, rather than inventing one", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.keyboard.press("Control+k");
    await expect(page.locator(".palette-input")).toBeVisible();
    for (const label of ["go to workspace", "new folder", "toggle light / dark theme"]) {
      const row = page.locator(".palette-cmd", { hasText: label });
      // Assert the row is there first: "no kbd" is trivially true of a palette that never opened.
      await expect(row).toHaveCount(1);
      await expect(row.locator("kbd")).toHaveCount(0);
    }
  });

  test("pluralises the request count instead of always saying \"requests\"", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.keyboard.press("Control+k");
    await expect(page.locator(".palette-input")).toBeVisible();
    await expect(page.locator(".palette-foot")).toContainText("2 requests");
  });

  test("says \"1 request\", not \"1 requests\"", async ({ app, page }) => {
    // The fixture seeds two; removing one is the only way to reach the singular the footer used to
    // get wrong, and the count comes from the workspace rather than from the filtered list.
    rmSync(join(app.dir, "evil.tspec.yaml"));
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.keyboard.press("Control+k");
    await expect(page.locator(".palette-input")).toBeVisible();
    await expect(page.locator(".palette-foot")).toContainText("1 request");
    await expect(page.locator(".palette-foot")).not.toContainText("requests");
  });
});
