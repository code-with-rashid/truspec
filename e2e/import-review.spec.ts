import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// UX round 13: importing a Postman/Bruno collection used to happen the instant a file was picked
// — no preview of what would be imported, no chance to rename the destination folder before it
// was written, and (since the target name was auto-derived from the collection's own name) no way
// to avoid a collision without importing wrong and fixing it after. This adds a review step,
// computed entirely client-side from the picked file(s) — no server round-trip needed just to
// preview, since the importer has no separate "dry run" mode.
test.describe("import review step (real browser)", () => {
  test("picking a Postman file shows a request count and an editable target folder before writing anything", async ({ app, page }) => {
    const dir = mkdtempSync(join(tmpdir(), "tspec-postman-fixture-"));
    const file = join(dir, "demo.json");
    writeFileSync(
      file,
      JSON.stringify({
        info: { name: "Demo Collection" },
        item: [
          { name: "Ping", request: { method: "GET", url: "{{baseUrl}}/ping" } },
          { name: "Health", request: { method: "GET", url: "{{baseUrl}}/health" } },
        ],
      }),
    );

    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".nav-btn", { hasText: "flow" }).click();
    await page.locator(".btn.ghost.small", { hasText: "import collection" }).click();

    const fileInput = page.locator('input[type="file"]:not([webkitdirectory])');
    await fileInput.setInputFiles(file);

    // review step: nothing written yet, count shown, target editable
    await expect(page.locator(".modal-body")).toContainText("found 2 requests in Demo Collection");
    expect(existsSync(join(app.dir, "demo-collection"))).toBe(false);

    const targetInput = page.locator(".modal .kv-input");
    await targetInput.fill("");
    await targetInput.fill("my-import");
    await page.locator(".modal-actions .btn.run").click();
    await page.waitForTimeout(500);

    expect(existsSync(join(app.dir, "my-import"))).toBe(true);
    await expect(page.locator(".modal-body")).toContainText("Imported 2 requests into my-import/");
  });
});
