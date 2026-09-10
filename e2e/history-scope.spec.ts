import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

const entry = (path: string, name: string) => ({
  path,
  name,
  method: "GET",
  url: "http://127.0.0.1:9/x",
  ok: true,
  status: 200,
  durationMs: 12,
  at: Date.now() - 60_000,
});

/**
 * `truspec serve` always answers on the same origin, so a single `localStorage` key made the send
 * log follow the *browser* rather than the collection: serve one project, send a request, serve a
 * different project on the same port, and the history rail listed a request that does not exist
 * there — a row that did nothing at all when clicked, with no message.
 */
test.describe("the history rail is scoped to its workspace (real browser)", () => {
  test("shows this workspace's log and not another's", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.evaluate(
      ([dir, mine, theirs]) => {
        localStorage.setItem(`truspec.history:${dir}`, JSON.stringify([mine]));
        localStorage.setItem("truspec.history:/some/other/project", JSON.stringify([theirs]));
      },
      [app.dir, entry("get.tspec.yaml", "Mine here"), entry("elsewhere.tspec.yaml", "Theirs elsewhere")] as const,
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.click(".rail-tab:has-text('history')");

    await expect(page.locator(".result-list")).toContainText("Mine here");
    await expect(page.locator(".result-list")).not.toContainText("Theirs elsewhere");
  });

  test("adopts a pre-scoping log once, then stops using the old key", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.evaluate(
      (legacy) => localStorage.setItem("truspec.history", JSON.stringify([legacy])),
      entry("get.tspec.yaml", "From before the upgrade"),
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.click(".rail-tab:has-text('history')");

    await expect(page.locator(".result-list")).toContainText("From before the upgrade");
    // Adopted under this workspace's key, and the unscoped one is gone so it cannot be adopted
    // a second time by a different collection.
    const keys = await page.evaluate((dir) => ({
      scoped: localStorage.getItem(`truspec.history:${dir}`),
      legacy: localStorage.getItem("truspec.history"),
    }), app.dir);
    expect(keys.scoped).toContain("From before the upgrade");
    expect(keys.legacy).toBeNull();
  });
});

/**
 * A log entry outlives the file it names — renamed, deleted, or on a branch you switched away
 * from. Clicking such a row opened nothing and said nothing.
 */
test.describe("a history entry whose request is gone (real browser)", () => {
  test("is marked and not clickable, instead of silently doing nothing", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.evaluate(
      ([dir, live, dead]) => {
        localStorage.setItem(`truspec.history:${dir}`, JSON.stringify([live, dead]));
      },
      [app.dir, entry("get.tspec.yaml", "Still here"), entry("deleted.tspec.yaml", "Long gone")] as const,
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.click(".rail-tab:has-text('history')");

    const live = page.locator(".rrow", { hasText: "Still here" });
    const dead = page.locator(".rrow", { hasText: "Long gone" });
    await expect(live).toBeEnabled();
    await expect(live.locator(".rrow-gone")).toHaveCount(0);
    await expect(dead).toBeDisabled();
    await expect(dead.locator(".rrow-gone")).toHaveText("gone");
    await expect(dead).toHaveAttribute("title", /no longer in this collection/);
  });

  test("marks an entry that was live until the file was removed", async ({ app, page }) => {
    writeFileSync(
      join(app.dir, "temp.tspec.yaml"),
      `tspec: "0.1"\nname: Temporary\nmethod: GET\nurl: "http://127.0.0.1:9/t"\nassertions: []\n`,
    );
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.evaluate(
      ([dir, e]) => localStorage.setItem(`truspec.history:${dir}`, JSON.stringify([e])),
      [app.dir, entry("temp.tspec.yaml", "Temporary")] as const,
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.click(".rail-tab:has-text('history')");
    await expect(page.locator(".rrow", { hasText: "Temporary" })).toBeEnabled();

    rmSync(join(app.dir, "temp.tspec.yaml"));
    await page.reload({ waitUntil: "networkidle" });
    await page.click(".rail-tab:has-text('history')");
    await expect(page.locator(".rrow", { hasText: "Temporary" })).toBeDisabled();
  });
});
