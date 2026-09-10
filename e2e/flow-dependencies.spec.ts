import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

/**
 * The flow view draws each dependency as a curve in a 38px rail, 1.5px wide, in border colour,
 * with the variable name hidden in an SVG `<title>`. So the one question the view exists to answer
 * — which request feeds which, with what — needed hovering a hairline, and before any step was
 * selected the graph read as a stray squiggle. The edges were already computed; only the naming
 * was missing.
 */
test.describe("the flow view names what travels between steps (real browser)", () => {
  async function seed(dir: string): Promise<void> {
    writeFileSync(
      join(dir, "01-login.tspec.yaml"),
      `tspec: "0.1"\nname: Log in\nmethod: POST\nurl: "http://127.0.0.1:9/login"\norder: 1\ncapture:\n  token: "$.access_token"\n  userId: "$.user.id"\nassertions: []\n`,
    );
    writeFileSync(
      join(dir, "02-me.tspec.yaml"),
      `tspec: "0.1"\nname: Get me\nmethod: GET\nurl: "http://127.0.0.1:9/users/{{userId}}"\norder: 2\nauth: { type: bearer, token: "{{token}}" }\nassertions: []\n`,
    );
    writeFileSync(
      join(dir, "03-list.tspec.yaml"),
      `tspec: "0.1"\nname: List things\nmethod: GET\nurl: "http://127.0.0.1:9/things"\norder: 3\nauth: { type: bearer, token: "{{token}}" }\nassertions: []\n`,
    );
  }

  test("shows each step's incoming variables, without a hover or a selection", async ({ app, page }) => {
    await seed(app.dir);
    await page.goto(app.url);
    await page.click("text=flow");

    const node = (name: string) => page.locator(".flow-node", { hasText: name });
    // The producer takes nothing from anyone.
    await expect(node("Log in").locator(".flow-needs")).toHaveCount(0);
    // The consumers say what they run on, in the order the rail draws them.
    await expect(node("Get me").locator(".flow-needs-var")).toHaveText(["userId", "token"]);
    await expect(node("List things").locator(".flow-needs-var")).toHaveText(["token"]);
  });

  test("names the producing request in the title, which the chips alone cannot fit", async ({ app, page }) => {
    await seed(app.dir);
    await page.goto(app.url);
    await page.click("text=flow");
    const title = await page
      .locator(".flow-node", { hasText: "Get me" })
      .locator(".flow-needs")
      .getAttribute("title");
    expect(title).toContain("{{userId}} from Log in");
    expect(title).toContain("{{token}} from Log in");
  });

  test("draws one edge per dependency, still", async ({ app, page }) => {
    await seed(app.dir);
    await page.goto(app.url);
    await page.click("text=flow");
    // token→2, userId→2, token→3.
    await expect(page.locator(".flow-rail path.edge")).toHaveCount(3);
  });

  test("says nothing on a collection whose steps are independent", async ({ app, page }) => {
    writeFileSync(
      join(app.dir, "a.tspec.yaml"),
      `tspec: "0.1"\nname: Alpha\nmethod: GET\nurl: "http://127.0.0.1:9/a"\norder: 1\nassertions: []\n`,
    );
    writeFileSync(
      join(app.dir, "b.tspec.yaml"),
      `tspec: "0.1"\nname: Beta\nmethod: GET\nurl: "http://127.0.0.1:9/b"\norder: 2\nassertions: []\n`,
    );
    await page.goto(app.url);
    await page.click("text=flow");
    await expect(page.locator(".flow-node", { hasText: "Alpha" })).toHaveCount(1);
    // The workspace fixture's own requests are independent too, so nothing anywhere claims a
    // dependency.
    await expect(page.locator(".flow-needs")).toHaveCount(0);
  });
});
