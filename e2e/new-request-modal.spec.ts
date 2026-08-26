import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// UX round 6: creating a request used to always mean opening a blank raw-YAML file, even after
// rounds 1-5 made every field of an EXISTING request inline-editable. That was the last major
// inconsistency versus Postman/Bruno's "click + and start typing" flow. The sidebar's original
// raw-YAML "+ new" button (tested by e2e/editor.spec.ts via its `.new-request` class) is
// preserved unchanged as the power-user path; this adds a guided name/method/path form as the
// new default "+ new" action.
test.describe("guided new-request modal (real browser)", () => {
  test("creating a request via the guided modal writes a valid file and opens it, fully inline-editable", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click(".new-request-quick");

    await page.fill(".modal input.kv-input >> nth=0", "Delete Widget");
    await page.selectOption(".modal select", "DELETE");
    await page.click(".modal-actions .btn.run");
    await page.waitForTimeout(500);

    const filePath = join(app.dir, "delete-widget.tspec.yaml");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf8");
    expect(content).toContain("name: Delete Widget");
    expect(content).toContain("method: DELETE");

    // opened as a tab, method/URL immediately inline-editable (round 2's work)
    await expect(page.locator(".tab-strip-item", { hasText: "Delete Widget" })).toHaveCount(1);
    await expect(page.locator(".method-select")).toHaveValue("DELETE");
  });

  test("the raw-YAML new-request button (.new-request) still opens the Editor directly, unchanged", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click(".new-request");
    await expect(page.locator(".editor .path-input")).toHaveCount(1);
    await expect(page.locator(".modal")).toHaveCount(0);
  });
});
