import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// Guards against a malformed OpenAPI spec leaving the spec view stuck on an infinite
// "analyzing…" spinner and the workspace rail silently showing false "0 drift issues".
test.describe("spec view error handling (real browser)", () => {
  test("a spec file that fails to parse surfaces an error, not an infinite spinner or false zeros", async ({ app, page }) => {
    writeFileSync(join(app.dir, "openapi.yaml"), "openapi: 3.0.3\ninfo:\n  title: [broken\n  not valid yaml: {{{{\n");
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });

    await page.click(".nav-btn:has-text('spec')");
    await expect(page.locator("text=couldn't analyze")).toHaveCount(1);
    // Must not be stuck on the loading placeholder once the error has landed.
    await expect(page.locator("text=analyzing openapi.yaml…")).toHaveCount(0);

    await page.click(".nav-btn:has-text('workspace')");
    await page.locator(".req", { hasText: "Get pet" }).click();
    await expect(page.locator("text=spec analysis failed")).not.toHaveCount(0);
    // The old behavior rendered a literal "0" for untracked/stale/changed here, indistinguishable
    // from a real clean report — assert the mini drift grid (which only ever showed numbers) is gone.
    await expect(page.locator(".drift-mini-grid")).toHaveCount(0);
  });
});
