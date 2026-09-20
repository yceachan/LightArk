import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: process.env.FOLIO_TEST_URL || "http://127.0.0.1:8787",
    headless: true,
    viewport: { width: 1440, height: 960 },
    launchOptions: process.env.FOLIO_CHROME
      ? { executablePath: process.env.FOLIO_CHROME }
      : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
