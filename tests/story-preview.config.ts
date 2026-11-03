import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "story-preview.spec.ts",
  timeout: 60000,
  workers: 1,
  reporter: "list",
  use: {
    channel: process.env.STORY_BROWSER === "chromium" ? undefined : "msedge",
    headless: true,
    serviceWorkers: "block",
  },
});
