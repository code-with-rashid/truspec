import { test, expect } from "./fixtures";

// UX round 12 (visual pass, explicitly requested): the whole UI — including nav labels, buttons,
// request names, and dashboard stats — previously rendered in the monospace font, all the time.
// Postman/Bruno both reserve monospace for genuinely technical strings (URLs, paths, request/
// response bodies, code) and use a regular UI font for everything else. Locks in that split so it
// doesn't silently regress back to "everything is monospace" or drift the other way ("nothing is").
test.describe("typography: sans for UI chrome, mono for technical strings (real browser)", () => {
  test("request names and nav labels use the sans body font", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    const family = await page.locator(".rname", { hasText: "Get pet" }).evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family.toLowerCase()).toContain("ibm plex sans");
  });

  test("the URL bar and response body stay in the monospace font", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();

    const urlFamily = await page.locator(".url-input").evaluate((el) => getComputedStyle(el).fontFamily);
    expect(urlFamily.toLowerCase()).toContain("ibm plex mono");

    await page.click(".req-top .btn.run"); // send
    await expect(page.locator(".response-head .pill")).toHaveCount(1, { timeout: 5000 });
    const bodyFamily = await page.locator(".response-body-wrap .body").evaluate((el) => getComputedStyle(el).fontFamily);
    expect(bodyFamily.toLowerCase()).toContain("ibm plex mono");
  });
});
