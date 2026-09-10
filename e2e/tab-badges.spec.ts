import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

// `params`, `headers`, `capture` and `assertions` have always shown a count, so the tab strip was
// a request's table of contents — except for the three that matter most. A four-part multipart
// body looked exactly like no body, bearer auth exactly like none, and a request carrying a script
// (which runs with the same access as the truspec process) was completely silent about it.
test.describe("the request tab strip says what each tab holds (real browser)", () => {
  test("badges the body type, the auth scheme, and the script's phases", async ({ app, page }) => {
    writeFileSync(
      join(app.dir, "loaded.tspec.yaml"),
      `tspec: "0.1"
name: Loaded
method: POST
url: "http://127.0.0.1:9/u"
auth: { type: bearer, token: "{{tok}}" }
body:
  type: multipart
  fields:
    title: "t"
    note: { file: "./note.txt" }
    other: "o"
script:
  pre: |
    tr.set("tok", "x")
assertions: [ { type: status, equals: 200 } ]
`,
    );
    await page.goto(app.url);
    await page.locator(".req", { hasText: "Loaded" }).click();

    const tabs = page.locator(".tabs").first();
    await expect(tabs).toContainText("body multipart 3");
    await expect(tabs).toContainText("auth bearer");
    await expect(tabs).toContainText("script pre");

    // The script badge is the one that should catch the eye, so it is styled apart from the rest.
    const warn = page.locator(".tab-badge.warn");
    await expect(warn).toHaveText("pre");
    const [warnColor, plainColor] = await Promise.all([
      warn.evaluate((el) => getComputedStyle(el).color),
      page.locator(".tab-badge:not(.warn)").first().evaluate((el) => getComputedStyle(el).color),
    ]);
    expect(warnColor).not.toBe(plainColor);
  });

  test("says nothing on a request that has none of the three", async ({ app, page }) => {
    writeFileSync(
      join(app.dir, "plain.tspec.yaml"),
      `tspec: "0.1"\nname: Plain\nmethod: GET\nurl: "http://127.0.0.1:9/p"\nassertions: []\n`,
    );
    await page.goto(app.url);
    await page.locator(".req", { hasText: "Plain" }).click();
    // `params 0` reads fine as a count; `body none` would not, so an empty badge is absent.
    await expect(page.locator(".tabs").first()).toHaveCount(1);
    await expect(page.locator(".tab-badge")).toHaveCount(0);
  });

  test("shows the body type for the non-keyed kinds, and the count for the keyed ones", async ({ app, page }) => {
    writeFileSync(
      join(app.dir, "kinds.tspec.yaml"),
      `tspec: "0.1"\nname: Kinds\nmethod: POST\nurl: "http://127.0.0.1:9/k"\nbody: { type: json, content: { a: 1 } }\nassertions: []\n`,
    );
    await page.goto(app.url);
    await page.locator(".req", { hasText: "Kinds" }).click();
    await expect(page.locator(".tabs").first()).toContainText("body json");
  });
});
