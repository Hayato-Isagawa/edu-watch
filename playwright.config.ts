import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:4174",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npx serve dist -l 4174",
    port: 4174,
    // ローカルでも既存のサーバーを再利用しない。4174 に別の配信が残っていると、
    // その dist を検証してしまう（理由の詳細は playwright.vrt.config.ts）。
    reuseExistingServer: false,
  },
});
