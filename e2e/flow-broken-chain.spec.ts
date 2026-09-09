import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

// The Flow view exists to show the chain. When a link breaks, the step that *caused* it passes —
// its capture matched nothing — and the step three rows down fails for a reason it cannot explain.
// The break has to be visible where it happened.
const chain = (dir: string): void => {
  mkdirSync(join(dir, "chain"), { recursive: true });
  writeFileSync(
    join(dir, "chain", "01-login.tspec.yaml"),
    'tspec: "0.1"\nname: Login\nmethod: POST\nurl: "{{baseUrl}}/login"\norder: 1\ncapture:\n  token: "$.access_token"\nassertions: []\n',
  );
  writeFileSync(
    join(dir, "chain", "02-me.tspec.yaml"),
    'tspec: "0.1"\nname: Me\nmethod: GET\nurl: "{{baseUrl}}/me"\norder: 2\nauth: { type: bearer, token: "{{token}}" }\nassertions: []\n',
  );
};

test.describe("a broken chain in the flow view (real browser)", () => {
  test("marks the step whose capture produced nothing, and says why the next one failed", async ({ app, page }) => {
    // The fixture's upstream answers {"id":1,"name":"Rex"} to everything, so `$.access_token`
    // matches nothing and `{{token}}` is never set.
    chain(app.dir);
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click("button:has-text('flow')");
    await page.click("button:has-text('run flow')");

    const login = page.locator(".flow-node", { hasText: "Login" });
    await expect(login.locator(".pill", { hasText: "pass" })).toBeVisible({ timeout: 15_000 });
    const warn = login.locator(".pill", { hasText: "not captured" });
    await expect(warn).toBeVisible();
    await expect(warn).toHaveAttribute("title", /token ← \$\.access_token matched nothing/);
    await expect(warn).toHaveAttribute("title", /has no "access_token"/);

    // The step that failed had no response at all, so "fail" on its own says nothing.
    const me = page.locator(".flow-node", { hasText: "Me" });
    await expect(me.locator(".flow-node-why")).toContainText("Unresolved variables: {{token}}");
  });

  test("the inspector names the capture that matched nothing", async ({ app, page }) => {
    chain(app.dir);
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click("button:has-text('flow')");
    await page.click("button:has-text('run flow')");
    await expect(page.locator(".flow-node", { hasText: "Login" }).locator(".pill", { hasText: "pass" })).toBeVisible({
      timeout: 15_000,
    });

    await page.locator(".flow-node", { hasText: "Login" }).click();
    await expect(page.locator(".capture-missed")).toContainText("matched nothing");
    await expect(page.locator(".capture-missed")).toContainText('$ has no "access_token"');
  });

  test("says nothing of the sort when the chain works", async ({ app, page }) => {
    // `$.name` is in the fixture's response, so this capture succeeds.
    mkdirSync(join(app.dir, "chain"), { recursive: true });
    writeFileSync(
      join(app.dir, "chain", "01-login.tspec.yaml"),
      'tspec: "0.1"\nname: Login\nmethod: POST\nurl: "{{baseUrl}}/login"\norder: 1\ncapture:\n  who: "$.name"\nassertions: []\n',
    );
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.click("button:has-text('flow')");
    await page.click("button:has-text('run flow')");
    await expect(page.locator(".flow-node", { hasText: "Login" }).locator(".pill", { hasText: "pass" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".pill", { hasText: "not captured" })).toHaveCount(0);
  });
});
