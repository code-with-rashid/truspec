import { defineConfig } from "@playwright/test";

// E2E regression suite for the web UI — guards the browser-only bugs that unit/coverage testing can't
// reach (BUG-M/N CSRF, BUG-O keyboard a11y, BUG-P screen-reader a11y, XSS escaping).
// CI installs the browser via `playwright install --with-deps chromium`. Locally you can point at an
// existing chromium with PW_EXECUTABLE_PATH (+ LD_LIBRARY_PATH if needed).
export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    launchOptions: {
      executablePath: process.env.PW_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
