import { defineConfig, devices } from "@playwright/test";

// The server's own default port (server/src/index.ts); nothing else listens on the CI runner.
const port = 7878;

export default defineConfig({
  testDir: "./tests",
  outputDir: "../test-results",
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The production build served by the real server, so E2E covers what `npm start` runs.
  webServer: {
    command: "npm start",
    cwd: "..",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    env: { AGENT_TIMELINE_PORT: String(port) },
  },
});
