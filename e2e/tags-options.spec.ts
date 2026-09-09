import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

const withExtras = 'tspec: "0.1"\nname: Tagged\nmethod: GET\nurl: "{{baseUrl}}/pets/1"\ntags: [smoke, auth]\noptions: { timeoutMs: 5000, retries: 2, followRedirects: true }\nassertions: [ { type: status, equals: 200 } ]\n';

test.describe("tags and transport options (real browser)", () => {
  test("a request's tags are shown, addable and removable", async ({ app, page }) => {
    // `truspec run --tag smoke` shipped long before the UI could show a tag, so the selection you
    // run in CI was invisible in the client you author in.
    writeFileSync(join(app.dir, "tagged.tspec.yaml"), withExtras);
    await page.goto(app.url);
    await page.getByText("Tagged", { exact: true }).first().click();

    // The chip wraps its label around a remove button, so its text node is "smoke✕".
    await expect(page.getByRole("button", { name: "remove tag smoke" })).toBeVisible();
    await page.getByRole("button", { name: "remove tag auth" }).click();
    await page.getByRole("button", { name: "+ tag" }).click();
    await page.getByLabel("new tag").fill("nightly, slow");
    await page.getByLabel("new tag").press("Enter");

    await page.getByRole("button", { name: "save", exact: true }).click();
    await expect(page.getByText("unsaved changes")).toHaveCount(0);

    const saved = readFileSync(join(app.dir, "tagged.tspec.yaml"), "utf8");
    expect(saved).toContain("smoke");
    expect(saved).toContain("nightly");
    expect(saved).toContain("slow"); // one comma-separated entry becomes two tags
    expect(saved).not.toContain("auth");
  });

  test("transport options are editable, and clearing them removes the block entirely", async ({ app, page }) => {
    writeFileSync(join(app.dir, "tagged.tspec.yaml"), withExtras);
    await page.goto(app.url);
    await page.getByText("Tagged", { exact: true }).first().click();

    await expect(page.getByLabel("retries")).toHaveValue("2");
    await page.getByLabel("retries").fill("4");
    await page.getByRole("button", { name: "save", exact: true }).click();
    await expect(page.getByText("unsaved changes")).toHaveCount(0);
    expect(readFileSync(join(app.dir, "tagged.tspec.yaml"), "utf8")).toContain("retries: 4");

    await page.getByRole("button", { name: "remove" }).last().click();
    await page.getByRole("button", { name: "save", exact: true }).click();
    await expect(page.getByText("unsaved changes")).toHaveCount(0);
    // An empty `options: {}` in the diff would be noise that means nothing.
    expect(readFileSync(join(app.dir, "tagged.tspec.yaml"), "utf8")).not.toContain("options");
  });

  test("editing an unrelated field does not drop tags or options from the file", async ({ app, page }) => {
    // The save path spreads the draft, so these survive at runtime — but nothing asserted it, and
    // one 'tidy the type' change away it would silently delete both.
    writeFileSync(join(app.dir, "tagged.tspec.yaml"), withExtras);
    await page.goto(app.url);
    await page.getByText("Tagged", { exact: true }).first().click();

    const url = page.getByLabel("request URL");
    await url.fill("{{baseUrl}}/pets/2");
    await page.getByRole("button", { name: "save", exact: true }).click();
    await expect(page.getByText("unsaved changes")).toHaveCount(0);

    const saved = readFileSync(join(app.dir, "tagged.tspec.yaml"), "utf8");
    expect(saved).toContain("pets/2");
    expect(saved).toContain("smoke");
    expect(saved).toContain("timeoutMs: 5000");
  });
});
