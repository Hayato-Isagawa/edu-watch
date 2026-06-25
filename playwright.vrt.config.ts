import { defineConfig } from "@playwright/test";

const dist = process.env.VRT_DIST ?? "dist";

export default defineConfig({
  testDir: "./vrt",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  snapshotPathTemplate: "vrt/__screenshots__/{projectName}/{arg}{ext}",
  expect: {
    timeout: 30000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
    baseURL: "http://localhost:4174",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `npx serve ${dist} -l 4174`,
    port: 4174,
    reuseExistingServer: !process.env.CI,
  },
});
