import { test, expect } from "./fixtures";

// The suggestion menu is `position: fixed`, measured from the input's bounding rect, so it has to
// react to scrolling. It used to react by closing — on ANY scroll event in the document, captured
// at the root. That makes a menu the user is actively typing into vanish on one trackpad notch,
// with no way back except retyping `{{`; and any reflow that scrolls an ancestor does the same
// thing invisibly. Repositioning is both the better affordance and the stable one.
test.describe("{{var}} suggestions survive scrolling (real browser)", () => {
  test("scrolling repositions the menu instead of dismissing it", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();

    await page.click(".url-input");
    await page.locator(".url-input").press("End");
    await page.keyboard.type("/{{ba");
    await expect(page.locator(".var-suggest-item")).toHaveText(["{{baseUrl}}"]);

    // Any scroll anywhere used to close it, so this is enough to reproduce the old behaviour.
    await page.evaluate(() => {
      document.dispatchEvent(new Event("scroll", { bubbles: false }));
    });

    await expect(page.locator(".var-suggest-item")).toHaveText(["{{baseUrl}}"]);

    // And it is still anchored to the input, not stranded where it was first measured.
    const input = await page.locator(".url-input").boundingBox();
    const menu = await page.locator(".var-suggest").boundingBox();
    expect(input).not.toBeNull();
    expect(menu).not.toBeNull();
    expect(Math.abs(menu!.y - (input!.y + input!.height + 4))).toBeLessThan(2);
    expect(Math.abs(menu!.x - input!.x)).toBeLessThan(2);
  });

  test("a suggestion picked after a scroll still applies", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();

    await page.click(".url-input");
    await page.locator(".url-input").press("End");
    await page.keyboard.type("/{{ba");
    await expect(page.locator(".var-suggest-item")).toHaveText(["{{baseUrl}}"]);

    await page.evaluate(() => {
      document.dispatchEvent(new Event("scroll", { bubbles: false }));
    });
    await page.click(".var-suggest-item");
    await expect(page.locator(".url-input")).toHaveValue("{{baseUrl}}/pets/1/{{baseUrl}}");
  });
});
