import { defineConfig, devices } from "@playwright/test";

// サーバーの既定のポート (server/src/index.ts)。CI の runner ではほかに待ち受けるものが無い。
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
  // 本番のビルドを本物のサーバーで配信し、`npm start` で動くものを E2E で確認する。
  webServer: {
    command: "npm start",
    cwd: "..",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    // ログのルートは手書きの合成セッションにする (.claude/rules/synthetic-fixtures.md)。サーバーの作業ディレクトリ (cwd) はリポジトリのルート。
    env: {
      AGENT_TIMELINE_PORT: String(port),
      AGENT_TIMELINE_CLAUDE_PROJECTS_DIR: "fixtures/claude/projects",
      AGENT_TIMELINE_CODEX_SESSIONS_DIR: "fixtures/codex/sessions",
    },
  },
});
