import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

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
  // README の手順と同じ `npm start` (ビルドと起動) で動くものを E2E で確認する。
  webServer: {
    command: "npm start",
    cwd: "..",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    // `npm start` がビルドも行うため、既定の 60 秒より長く待つ。CI の runner での vite と tsc のビルドに余裕を持たせる。
    timeout: 180_000,
    // ログのルートは手書きの合成セッションにする (.claude/rules/synthetic-fixtures.md)。サーバーの作業ディレクトリ (cwd) はリポジトリのルート。
    // 利用記録は、runner のホームディレクトリではなく一時ディレクトリに書く。
    env: {
      AGENT_TIMELINE_PORT: String(port),
      AGENT_TIMELINE_CLAUDE_PROJECTS_DIR: "fixtures/claude/projects",
      AGENT_TIMELINE_CODEX_SESSIONS_DIR: "fixtures/codex/sessions",
      AGENT_TIMELINE_USAGE_DIR: path.join(os.tmpdir(), "agent-timeline-e2e"),
    },
  },
});
