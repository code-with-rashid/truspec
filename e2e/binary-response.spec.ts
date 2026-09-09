import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

// A 1x1 PNG. Real bytes, so "the file that was saved opens as a PNG" is a real claim.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
    "01f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082",
  "hex",
);

async function pngServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((_q, res) => {
    res.writeHead(200, { "content-type": "image/png", "content-length": PNG.length });
    res.end(PNG);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as { port: number }).port };
}

test.describe("a binary response body (real browser)", () => {
  test("says what arrived and previews it, instead of printing a lossy decode", async ({ app, page }) => {
    const { server, port } = await pngServer();
    try {
      writeFileSync(
        join(app.dir, "png.tspec.yaml"),
        `tspec: "0.1"\nname: Png\nmethod: GET\nurl: "http://127.0.0.1:${port}/x.png"\nassertions: [ { type: status, equals: 200 } ]\n`,
      );
      await page.goto(app.url);
      await page.locator(".req", { hasText: "Png" }).click();
      await page.click(".req-top .btn.run");
      await expect(page.locator(".response-head .pill")).toHaveCount(1, { timeout: 5000 });

      await expect(page.locator(".body-binary")).toContainText("image/png");
      await expect(page.locator(".body-binary")).toContainText(`${PNG.length} bytes`);
      // The image itself, decoded by the browser — proof the bytes survived the round trip.
      const size = await page.locator(".body-image").evaluate((el) => ({
        w: (el as HTMLImageElement).naturalWidth,
        h: (el as HTMLImageElement).naturalHeight,
      }));
      expect(size).toEqual({ w: 1, h: 1 });
      // The size shown is the response's, not the character count of a mangled string.
      await expect(page.locator(".response-head .bytes")).toHaveText(`${PNG.length}b`);
    } finally {
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  test("saves the bytes the server sent, named .png", async ({ app, page }) => {
    const { server, port } = await pngServer();
    try {
      writeFileSync(
        join(app.dir, "png.tspec.yaml"),
        `tspec: "0.1"\nname: Png\nmethod: GET\nurl: "http://127.0.0.1:${port}/x.png"\nassertions: [ { type: status, equals: 200 } ]\n`,
      );
      await page.goto(app.url);
      await page.locator(".req", { hasText: "Png" }).click();
      await page.click(".req-top .btn.run");
      await expect(page.locator(".response-head .pill")).toHaveCount(1, { timeout: 5000 });

      const captured = await page.evaluate(async () => {
        const originalCreate = URL.createObjectURL;
        let blob: Blob | null = null;
        URL.createObjectURL = (obj: Blob | MediaSource) => {
          if (obj instanceof Blob) blob = obj;
          return originalCreate.call(URL, obj);
        };
        const originalClick = HTMLAnchorElement.prototype.click;
        let download = "";
        HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
          download = this.download;
        };
        Array.from(document.querySelectorAll("button"))
          .find((b) => b.textContent?.trim() === "⇩ save")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 100));
        URL.createObjectURL = originalCreate;
        HTMLAnchorElement.prototype.click = originalClick;
        const bytes = blob ? Array.from(new Uint8Array(await (blob as Blob).arrayBuffer())) : null;
        return { download, bytes, type: blob ? (blob as Blob).type : null };
      });

      expect(captured.download).toBe("png.png");
      expect(captured.type).toBe("image/png");
      // Byte-for-byte. Saving the decoded text produced a longer, corrupt file that no viewer opens.
      expect(Buffer.from(captured.bytes ?? []).equals(PNG)).toBe(true);
    } finally {
      await new Promise((r) => server.close(() => r(undefined)));
    }
  });

  test("leaves an ordinary JSON response reading as text", async ({ app, page }) => {
    await page.goto(app.url);
    await page.locator(".req", { hasText: "Get pet" }).click();
    await page.click(".req-top .btn.run");
    await expect(page.locator(".response-head .pill")).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator(".body-binary")).toHaveCount(0);
    await expect(page.locator("pre.body")).toContainText("Rex");
  });
});
