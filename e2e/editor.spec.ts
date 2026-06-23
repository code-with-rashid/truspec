import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// Guards the editor interaction bugs (BUG-O keyboard scoping) and the save flow.
test.describe("editor interactions (real browser)", () => {
  test("valid save writes the file and updates the sidebar", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.waitForSelector(".newreq");
    await page.click(".newreq");
    await page.fill(".editor .path-input", "folderx/created.tspec.yaml");
    await page.fill(".editor .editor-text", 'tspec: "0.1"\nname: Created Req\nmethod: POST\nurl: "http://x/y"\nassertions: []\n');
    await page.click(".editor .btn.run");
    await page.waitForTimeout(700);
    expect(existsSync(join(app.dir, "folderx", "created.tspec.yaml"))).toBe(true);
    await expect(page.locator(".rname", { hasText: "Created Req" })).toHaveCount(1);
  });

  test("BUG-O: Esc cancels the editor from the path input (not only the textarea)", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click(".newreq");
    await page.click(".editor .path-input");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await expect(page.locator(".editor")).toHaveCount(0);
  });

  test("BUG-O: Ctrl+Enter saves from anywhere in the editor", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click(".newreq");
    await page.fill(".editor .path-input", "kbd.tspec.yaml");
    await page.fill(".editor .editor-text", 'tspec: "0.1"\nname: Kbd\nurl: "http://x"\nassertions: []\n');
    await page.click(".editor .editor-text");
    await page.keyboard.press("Control+Enter");
    await page.waitForTimeout(700);
    expect(existsSync(join(app.dir, "kbd.tspec.yaml"))).toBe(true);
  });

  test("a traversal save path is refused and writes nothing outside the workspace", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click(".newreq");
    await page.fill(".editor .path-input", "../../../../tmp/tspec-e2e-escape.tspec.yaml");
    await page.fill(".editor .editor-text", 'tspec: "0.1"\nname: Evil\nurl: "http://x"\nassertions: []\n');
    await page.click(".editor .btn.run");
    await page.waitForTimeout(500);
    await expect(page.locator(".editor-err")).toHaveCount(1);
    expect(existsSync("/tmp/tspec-e2e-escape.tspec.yaml")).toBe(false);
  });

  test("double-click save produces one uncorrupted file (re-entrancy)", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click(".newreq");
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
