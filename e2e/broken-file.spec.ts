import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

/** Wait out any in-flight transition so a screenshot-free assertion isn't racing a fade. */
async function settle(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
}

test.describe("a file that does not parse (real browser)", () => {
  test("is named in the sidebar instead of silently vanishing from the tree", async ({ page, app }) => {
    // Pre-fix: /api/state reported it, and the UI displayed nothing at all — the file simply was
    // not in the tree, which reads as "deleted" rather than "broken".
    writeFileSync(join(app.dir, "broken.tspec.yaml"), 'tspec: "0.1"\nname: Broken\nmethod: GET\nurl: "http://x"\nheadrs: { a: b }\n');
    await page.goto(app.url);
    await settle(page);

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("1 file could not be read");
    await expect(alert).toContainText("broken.tspec.yaml");
  });

  test("shows the schema error, and the key it was probably meant to be", async ({ page, app }) => {
    writeFileSync(join(app.dir, "broken.tspec.yaml"), 'tspec: "0.1"\nname: Broken\nmethod: GET\nurl: "http://x"\nheadrs: { a: b }\n');
    await page.goto(app.url);
    await settle(page);

    await page.getByText("broken.tspec.yaml").click();
    await expect(page.getByRole("alert")).toContainText("did you mean 'headers'?");
  });

  test("stays out of the way when every file parses", async ({ page, app }) => {
    await page.goto(app.url);
    await settle(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
