import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// The files in your repo are the source of truth, and other things edit them while a tab is open:
// an agent through the MCP server, a `git pull`, the user's own editor. A save used to write
// whatever the tab held, so whatever had landed in between was gone with no message.
test.describe("a file edited on disk while it is open (real browser)", () => {
  const external = (dir: string): string => {
    const p = join(dir, "get.tspec.yaml");
    writeFileSync(p, `${readFileSync(p, "utf8")}docs: "written by someone else"\n`);
    return p;
  };

  test("refuses the save instead of discarding the other edit, and offers both ways out", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.selectOption(".method-select", "POST");

    const file = external(app.dir);
    await page.click(".dirty-bar .btn.run");

    await expect(page.locator(".modal-head")).toContainText("changed on disk");
    expect(readFileSync(file, "utf8")).toContain("written by someone else");
    expect(readFileSync(file, "utf8")).toContain("method: GET");
  });

  test("reload takes what is on disk and drops the draft", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.selectOption(".method-select", "POST");
    const file = external(app.dir);
    await page.click(".dirty-bar .btn.run");

    await page.click(".modal-actions .btn:not(.ghost):not(.danger)");
    await expect(page.locator(".modal")).toHaveCount(0);
    await expect(page.locator(".dirty-bar")).toHaveCount(0);
    await expect(page.locator(".method-select")).toHaveValue("GET");
    expect(readFileSync(file, "utf8")).toContain("written by someone else");
  });

  test("overwrite is available, and is the only way the other edit is lost", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.selectOption(".method-select", "POST");
    const file = external(app.dir);
    await page.click(".dirty-bar .btn.run");

    await page.click(".modal-actions .btn.danger");
    await expect(page.locator(".modal")).toHaveCount(0);
    await expect(page.locator(".dirty-bar")).toHaveCount(0);
    const after = readFileSync(file, "utf8");
    expect(after).toContain("method: POST");
    expect(after).not.toContain("written by someone else");
  });

  test("an ordinary save is untouched by the check", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.selectOption(".method-select", "PUT");
    await page.click(".dirty-bar .btn.run");
    await expect(page.locator(".dirty-bar")).toHaveCount(0);
    await expect(page.locator(".modal")).toHaveCount(0);
    expect(readFileSync(join(app.dir, "get.tspec.yaml"), "utf8")).toContain("method: PUT");
  });
});
