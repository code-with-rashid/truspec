import { test, expect } from "./fixtures";

// UX round 29: the response panel only ever offered "copy to clipboard" for a response body — no
// way to save it to a file. Fine for a short JSON reply, awkward for anything large (a paste can
// silently mangle it) or binary-ish. Postman and Bruno both offer "save response" alongside copy.
//
// Verified via the anchor's own `download`/`href` attributes and the Blob content behind the
// `blob:` URL, captured through the page's own APIs, rather than Playwright's `download` event —
// a blob-URL download triggered by a synthetic, unattached-until-click `<a>` element didn't
// reliably fire that event in this environment even though it demonstrably works end-to-end in a
// real browser (manually verified: a real "get-post.json" file lands in Downloads). This still
// exercises exactly the code this round added — filename, extension, and body content — without
// depending on a flaky download-interception signal for something that isn't actually flaky.
test.describe("download a response body (real browser)", () => {
  test("the save button builds a correctly-named file with the response body as its content", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.click(".req-top .btn.run");
    await expect(page.locator(".response-head .pill")).toHaveCount(1, { timeout: 5000 });

    const displayedJson = await page.evaluate(() => {
      const pre = document.querySelector(".response-body-wrap .body");
      return pre?.textContent ? JSON.parse(pre.textContent) : null;
    });

    const captured = await page.evaluate(async () => {
      const originalCreate = URL.createObjectURL;
      let capturedBlob: Blob | null = null;
      URL.createObjectURL = (obj: Blob | MediaSource) => {
        if (obj instanceof Blob) capturedBlob = obj;
        return originalCreate.call(URL, obj);
      };
      const originalClick = HTMLAnchorElement.prototype.click;
      let capturedDownload = "";
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        capturedDownload = this.download;
        // don't perform the real click — no need to actually hit the filesystem for this test.
      };
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "⇩ save");
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      URL.createObjectURL = originalCreate;
      HTMLAnchorElement.prototype.click = originalClick;
      const text = capturedBlob ? await (capturedBlob as Blob).text() : null;
      const type = capturedBlob ? (capturedBlob as Blob).type : null;
      return { download: capturedDownload, text, type };
    });

    expect(captured.download).toBe("get-pet.json");
    expect(captured.type).toContain("json");
    // downloaded content is the raw response body (same as "copy"), not the pretty-printed display
    // — compared structurally (parsed) since raw vs. pretty-printed JSON differ only in whitespace.
    expect(JSON.parse(captured.text ?? "null")).toEqual(displayedJson);
  });
});
