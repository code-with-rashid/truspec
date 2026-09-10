import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

/**
 * "No request at all" and "a request that exists but checks nothing" are both uncovered, and their
 * fixes are opposite: write one, versus open the one you have and give it assertions. The coverage
 * report has told them apart for a while and the CLI prints the difference — this view rendered
 * both as a flat `untested`, and then offered "create a request" as the only remedy, which sends
 * someone to write a second request for an operation that already has one.
 */
test.describe("the spec view tells an unasserted operation from an uncovered one (real browser)", () => {
  async function open(app: { dir: string; url: string }, page: import("@playwright/test").Page) {
    // The fixture's `get.tspec.yaml` is linked to `GET /pets/{id}` and asserts a status; strip its
    // assertions so the operation is covered-by-a-request-that-checks-nothing.
    writeFileSync(
      join(app.dir, "get.tspec.yaml"),
      'tspec: "0.1"\nname: Get pet\nmethod: GET\nurl: "{{baseUrl}}/pets/1"\nspec: { operation: "GET /pets/{id}" }\nassertions: []\n',
    );
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator("select").last().selectOption({ label: "openapi.yaml" });
    await page.locator(".nav-btn", { hasText: "spec" }).click();
    await expect(page.locator(".stat-card").first()).toBeVisible();
  }

  test("badges it `unasserted`, not `untested`", async ({ app, page }) => {
    await open(app, page);
    const row = page.locator(".op-row, .oprow", { hasText: "/pets/{id}" }).first();
    await expect(row.locator(".op-badge")).toHaveText("unasserted");
    // The genuinely uncovered operation keeps the plain badge.
    await expect(page.locator(".op-badge.untested").first()).toBeVisible();
  });

  test("names the request in the coverage card, so the reader knows which file to open", async ({ app, page }) => {
    await open(app, page);
    await expect(page.locator(".oplist")).toContainText('"Get pet" asserts nothing');
  });

  test("offers 'give it assertions' rather than 'create a request'", async ({ app, page }) => {
    await open(app, page);
    const group = page.locator(".resolve-groups");
    await expect(group).toContainText("Tested by a request that asserts nothing");
    await expect(group).toContainText("the request exists — give it assertions");
  });

  test("opens the existing request instead of starting a new one", async ({ app, page }) => {
    await open(app, page);
    await page.locator(".op.as-button", { hasText: "/pets/{id}" }).click();
    // Jumps to the workspace with that request open, rather than to a new-request flow.
    await expect(page.locator(".nav-btn.active")).toHaveText("workspace");
    // The request's own tab is open — the point is that it went to the existing file rather than
    // to a create-a-request flow.
    await expect(page.locator(".tab-strip, .tabs-bar").first()).toContainText("Get pet");
  });

  test("says nothing when every request asserts something", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator("select").last().selectOption({ label: "openapi.yaml" });
    await page.locator(".nav-btn", { hasText: "spec" }).click();
    await expect(page.locator(".stat-card").first()).toBeVisible();
    await expect(page.locator(".resolve-groups")).not.toContainText("asserts nothing");
    await expect(page.locator(".op-badge.unasserted")).toHaveCount(0);
  });
});
