import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** A server over a directory with nothing in it — somebody's first minute with the tool. */
async function emptyApp(): Promise<{ url: string; dir: string; close: () => Promise<void> }> {
  const { startWebServer } = (await import(`${ROOT}/packages/web/dist/server/index.js`)) as {
    startWebServer: (o: { dir: string; port: number; clientDir: string }) => Promise<{ url: string; close: () => Promise<void> }>;
  };
  const dir = mkdtempSync(join(tmpdir(), "tspec-empty-"));
  const web = await startWebServer({ dir, port: 0, clientDir: join(ROOT, "packages", "web", "dist", "client") });
  return {
    url: web.url,
    dir,
    close: async () => {
      await web.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test.describe("a workspace with nothing in it (real browser)", () => {
  test("says what is true and offers both ways forward", async ({ page }) => {
    // It used to say "select a request, or run the whole collection" — naming two things that do
    // not exist — and offer only "+ new request", while import (the fastest route for anyone
    // arriving from Postman) lived in a different view.
    const app = await emptyApp();
    try {
      await page.goto(app.url, { waitUntil: "networkidle" });
      await expect(page.locator(".empty")).toContainText("no requests here yet");
      await expect(page.locator(".empty")).not.toContainText("select a request");
      await expect(page.locator(".empty-actions .btn", { hasText: "+ new request" })).toBeVisible();
      await expect(page.locator(".empty-actions .btn", { hasText: "import a collection" })).toBeVisible();
      await expect(page.locator(".empty-actions .btn", { hasText: "+ environment" })).toBeVisible();
      await expect(page.locator(".empty")).toContainText("{{baseUrl}}");
    } finally {
      await app.close();
    }
  });

  test("does not offer to run nothing", async ({ page }) => {
    // "0 passed, 0 failed, ok" is the shape of every false green there is.
    const app = await emptyApp();
    try {
      await page.goto(app.url, { waitUntil: "networkidle" });
      const runAll = page.locator(".btn.run", { hasText: "run all" });
      await expect(runAll).toBeDisabled();
      await expect(runAll).toHaveAttribute("title", /no requests/);
    } finally {
      await app.close();
    }
  });

  test("import takes you somewhere that can actually import", async ({ page }) => {
    const app = await emptyApp();
    try {
      await page.goto(app.url, { waitUntil: "networkidle" });
      await page.locator(".empty-actions .btn", { hasText: "import a collection" }).click();
      await expect(page.locator(".nav .active, .nav button.active")).toContainText("flow");
      await expect(page.locator("button", { hasText: /import/i }).first()).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("goes back to the ordinary empty state once a request exists", async ({ page }) => {
    const app = await emptyApp();
    try {
      writeFileSync(
        join(app.dir, "one.tspec.yaml"),
        'tspec: "0.1"\nname: One\nmethod: GET\nurl: "http://127.0.0.1:1/x"\nassertions: []\n',
      );
      await page.goto(app.url, { waitUntil: "networkidle" });
      await expect(page.locator(".empty")).toContainText("select a request");
      await expect(page.locator(".btn.run", { hasText: "run all" })).toBeEnabled();
    } finally {
      await app.close();
    }
  });
});
