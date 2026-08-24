import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// Guards the editor interaction bugs (BUG-O keyboard scoping) and the save flow.
test.describe("editor interactions (real browser)", () => {
  test("valid save writes the file and updates the sidebar", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.waitForSelector(".new-request");
    await page.click(".new-request");
    await page.fill(".editor .path-input", "folderx/created.tspec.yaml");
    await page.fill(".editor .editor-text", 'tspec: "0.1"\nname: Created Req\nmethod: POST\nurl: "http://x/y"\nassertions: []\n');
    await page.click(".editor .btn.run");
    await page.waitForTimeout(700);
    expect(existsSync(join(app.dir, "folderx", "created.tspec.yaml"))).toBe(true);
    await expect(page.locator(".rname", { hasText: "Created Req" })).toHaveCount(1);
  });

  test("BUG-O: Esc cancels the editor from the path input (not only the textarea)", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click(".new-request");
    await page.click(".editor .path-input");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await expect(page.locator(".editor")).toHaveCount(0);
  });

  test("BUG-O: Ctrl+Enter saves from anywhere in the editor", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click(".new-request");
    await page.fill(".editor .path-input", "kbd.tspec.yaml");
    await page.fill(".editor .editor-text", 'tspec: "0.1"\nname: Kbd\nurl: "http://x"\nassertions: []\n');
    await page.click(".editor .editor-text");
    await page.keyboard.press("Control+Enter");
    await page.waitForTimeout(700);
    expect(existsSync(join(app.dir, "kbd.tspec.yaml"))).toBe(true);
  });

  test("a traversal save path is refused and writes nothing outside the workspace", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click(".new-request");
    await page.fill(".editor .path-input", "../../../../tmp/tspec-e2e-escape.tspec.yaml");
    await page.fill(".editor .editor-text", 'tspec: "0.1"\nname: Evil\nurl: "http://x"\nassertions: []\n');
    await page.click(".editor .btn.run");
    await page.waitForTimeout(500);
    await expect(page.locator(".editor-err")).toHaveCount(1);
    expect(existsSync("/tmp/tspec-e2e-escape.tspec.yaml")).toBe(false);
  });

  test("renaming a request in the sidebar updates its displayed name, not just the file", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    const row = page.locator(".req", { hasText: "Get pet" });
    await row.hover();
    await row.locator('[title="rename request"]').click();
    await page.locator(".rename-input").fill("Fetch one pet");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    // The sidebar (bound to the request's `name:` field) must reflect the typed value immediately —
    // renaming only the file left the sidebar showing the stale old name.
    await expect(page.locator(".rname", { hasText: "Fetch one pet" })).toHaveCount(1);
    await expect(page.locator(".rname", { hasText: "Get pet" })).toHaveCount(0);
    expect(existsSync(join(app.dir, "Fetch one pet.tspec.yaml"))).toBe(true);
    expect(readFileSync(join(app.dir, "Fetch one pet.tspec.yaml"), "utf8")).toMatch(/name: Fetch one pet/);
  });

  test("command palette: Enter opens the top match (not just a mouse click)", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.keyboard.press("Control+k");
    await page.locator(".palette-input").fill("Get pet");
    await page.keyboard.press("Enter");
    await expect(page.locator(".palette-overlay")).toHaveCount(0);
    await expect(page.locator(".tab-strip-item", { hasText: "Get pet" })).toHaveCount(1);
  });

  test("closing a tab with unsaved changes asks for confirmation instead of discarding silently", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.locator(".tab", { hasText: "headers" }).click();
    await page.locator(".editable-kv-add").click();
    await page.locator(".editable-kv-key").fill("X-Dirty-Test");
    const tab = page.locator(".tab-strip-item", { hasText: "Get pet" });
    await expect(tab.locator(".tab-strip-dot")).toHaveCount(1);

    // Cancelling the confirm must leave the tab open and still dirty.
    await tab.locator(".tab-strip-close").click();
    await expect(page.locator(".modal-head", { hasText: "discard unsaved changes" })).toHaveCount(1);
    await page.locator(".modal .btn.ghost", { hasText: "cancel" }).click();
    await expect(tab).toHaveCount(1);
    await expect(tab.locator(".tab-strip-dot")).toHaveCount(1);

    // Confirming discards the edit and closes the tab.
    await tab.locator(".tab-strip-close").click();
    await page.locator(".modal .btn.danger", { hasText: "discard" }).click();
    await expect(page.locator(".tab-strip-item", { hasText: "Get pet" })).toHaveCount(0);
    expect(readFileSync(join(app.dir, "get.tspec.yaml"), "utf8")).not.toMatch(/X-Dirty-Test/);
  });

  test("double-click save produces one uncorrupted file (re-entrancy)", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click(".new-request");
    await page.fill(".editor .path-input", "dbl.tspec.yaml");
    await page.fill(".editor .editor-text", 'tspec: "0.1"\nname: Dbl\nurl: "http://x"\nassertions: []\n');
    const save = page.locator(".editor .btn.run");
    await save.click();
    await save.click({ timeout: 400 }).catch(() => {});
    await page.waitForTimeout(700);
    const content = existsSync(join(app.dir, "dbl.tspec.yaml")) ? readFileSync(join(app.dir, "dbl.tspec.yaml"), "utf8") : "";
    expect(content).toMatch(/name: Dbl/);
    expect(content.trim().endsWith("assertions: []")).toBe(true);
  });
});
