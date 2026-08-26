import { test, expect } from "./fixtures";

// UX round 28: every icon-only button across the app (sidebar row actions — rename/duplicate/
// delete — remove buttons in params/headers/assertions/capture rows, environment edit/delete/
// remove-secret, tab close, theme toggle, manage-environments gear, filter-clear) relied solely on
// `title` for its tooltip. That's not a meaningful fix on its own: `title` only becomes the
// *accessible name* when a button has no other content at all, and a button whose only visible
// content is a bare glyph (✕/✎/⧉/☾/☀/⚙) computes ITS OWN accessible name from that glyph — a
// real, non-empty string, so axe-core's automated "button-name" rule (which only flags a *missing*
// name) was never going to catch this; it's a "the name exists but is meaningless" problem, which
// only a direct check of what name a button actually exposes can verify. `page.getByRole` uses the
// browser's own full accessible-name computation, so asserting against it — not raw content or a
// `title` attribute — is the only check that actually distinguishes "silent icon" from "real name".
test.describe("icon-only buttons expose a real accessible name, not their raw glyph (real browser)", () => {
  test("sidebar row actions, editor remove buttons, and top-bar icon buttons all have descriptive names", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });

    // top-bar icon buttons, always present
    await expect(page.getByRole("button", { name: "manage environments" })).toBeVisible();
    await expect(page.getByRole("button", { name: "toggle theme" })).toBeVisible();

    // sidebar row actions — only exposed on hover
    const row = page.locator(".req", { hasText: "Get pet" });
    await row.hover();
    await expect(row.getByRole("button", { name: "rename request" })).toBeVisible();
    await expect(row.getByRole("button", { name: "duplicate request" })).toBeVisible();
    await expect(row.getByRole("button", { name: "delete request" })).toBeVisible();

    await row.click();

    // a tab's close button names itself after the request, not just "close"
    await expect(page.getByRole("button", { name: "close Get pet", exact: true })).toBeVisible();

    // an added row's remove button in headers/capture/assertions
    await page.locator(".tab", { hasText: "headers" }).click();
    await page.click(".editable-kv-add");
    await expect(page.locator(".tabpanel").getByRole("button", { name: "remove row" })).toBeVisible();

    await page.locator(".tab", { hasText: "capture" }).click();
    await page.click(".editable-kv-add");
    await expect(page.locator(".tabpanel").getByRole("button", { name: "remove capture" })).toBeVisible();

    await page.locator(".tab", { hasText: "assertions" }).click();
    await expect(page.locator(".tabpanel").getByRole("button", { name: "remove assertion" }).first()).toBeVisible();
  });
});
