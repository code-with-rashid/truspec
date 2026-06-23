import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";

// Guards the security bugs that only a real browser exposes.
test.describe("web UI security (real browser)", () => {
  test("XSS: a malicious request name is escaped, never executed (BUG-P precursor / campaign 7)", async ({ app, page }) => {
    await page.goto(`${app.url}/`, { waitUntil: "networkidle" });
    await page.waitForSelector(".rname");
    // the onerror payload must NOT have fired, and no live <img onerror> element exists
    expect(await page.evaluate(() => (window as unknown as { __xss?: boolean }).__xss)).toBeFalsy();
    expect(await page.locator("img[onerror]").count()).toBe(0);
    // the payload text is present, but escaped (visible as text)
    expect(await page.locator(".rname", { hasText: "onerror" }).count()).toBeGreaterThan(0);
  });

  test("clickjacking: every response carries X-Frame-Options: DENY (BUG-M)", async ({ app, request }) => {
    const res = await request.get(`${app.url}/`);
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    expect(res.headers()["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
  });

  test("CSRF: a page on ANOTHER loopback port cannot make /api/request execute (BUG-N)", async ({ app, page }) => {
    // Attacker origin on a different port — the exact cross-port-loopback vector BUG-N exposed.
    const attacker = createServer((_q, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><body><script>
        window.__done = false;
        fetch("${app.url}/api/request", { method:"POST", headers:{"content-type":"text/plain"},
          body: JSON.stringify({ path:"csrf-proof.tspec.yaml", content:"name: pwned\\nurl: http://x\\nassertions: []" }) })
          .then(()=>window.__done="sent").catch(()=>window.__done="blocked");
      </script></body>`);
    });
    await new Promise<void>((r) => attacker.listen(0, "127.0.0.1", () => r()));
    const attackerURL = `http://127.0.0.1:${(attacker.address() as { port: number }).port}`;
    try {
      await page.goto(`${attackerURL}/`, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      // The browser fetch is CORS-blocked either way; the real assertion is SERVER-SIDE: no file written.
      expect(existsSync(join(app.dir, "csrf-proof.tspec.yaml"))).toBe(false);
    } finally {
      await new Promise((r) => attacker.close(() => r(undefined)));
    }
  });

  test("CSRF: the API rejects a cross-origin Origin and accepts same-origin (BUG-M/N)", async ({ app, request }) => {
    const cross = await request.post(`${app.url}/api/run`, { headers: { origin: "http://evil.com", "content-type": "text/plain" }, data: "{}" });
    expect(cross.status()).toBe(403);
    const same = await request.post(`${app.url}/api/run`, { headers: { origin: app.url, "content-type": "application/json" }, data: "{}" });
    expect(same.status()).toBe(200);
  });
});
