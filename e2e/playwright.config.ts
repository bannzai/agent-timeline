import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// サーバーの既定のポート (server/src/index.ts)。CI の runner ではほかに待ち受けるものが無い。
const port = 7878;
// ログが 1 つも無い時の画面を見るための、2 つ目のサーバーのポート。既定のポートの隣で、CI の runner では空いている。
const emptyLogsPort = 7879;
// 自動更新を見るための、3 つ目のサーバーのポート。2 つ目の隣で、CI の runner では空いている。
const liveLogsPort = 7880;
// 自動更新の E2E が fixture を写してから追記するディレクトリ。リポジトリの fixtures/ を書き換えないため、リポジトリの外に置く。
// 設定は Playwright の本体と各 worker が別々に読むため、どこで読んでも同じパスになる固定の名前にする。
const liveLogsDirectory = path.join(os.tmpdir(), "agent-timeline-e2e-live-logs");

/** 本番のビルドを本物のサーバーで配信し、`npm start` で動くものを E2E で確認する。ログのルートは引数のディレクトリにする。 */
function productionServer(serverPort: number, logRoots: { claude: string; codex: string }) {
  return {
    command: "npm start",
    cwd: "..",
    url: `http://127.0.0.1:${serverPort}/api/health`,
    reuseExistingServer: false,
    // ログのルートは手書きの合成セッションにする (.claude/rules/synthetic-fixtures.md)。サーバーの作業ディレクトリ (cwd) はリポジトリのルート。
    env: {
      AGENT_TIMELINE_PORT: String(serverPort),
      AGENT_TIMELINE_CLAUDE_PROJECTS_DIR: logRoots.claude,
      AGENT_TIMELINE_CODEX_SESSIONS_DIR: logRoots.codex,
    },
  };
}

export default defineConfig({
  testDir: "./tests",
  outputDir: "../test-results",
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  projects: [
    {
      name: "chromium",
      testIgnore: /(empty-logs|live-updates)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${port}` },
    },
    {
      name: "chromium-empty-logs",
      testMatch: /empty-logs\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${emptyLogsPort}` },
    },
    {
      name: "chromium-live-updates",
      testMatch: /live-updates\.spec\.ts/,
      // テストは testInfo.project.metadata からこのディレクトリを読み、fixture を写して追記する。
      metadata: { liveLogsDirectory },
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${liveLogsPort}` },
    },
  ],
  webServer: [
    productionServer(port, {
      claude: "fixtures/claude/projects",
      codex: "fixtures/codex/sessions",
    }),
    // fixtures/empty は、ログのファイルを持たないディレクトリ (git に残すための .gitkeep だけを持つ)。
    productionServer(emptyLogsPort, { claude: "fixtures/empty", codex: "fixtures/empty" }),
    // サーバーは、ログのルートが無い間は空の一覧を返し、テストが fixture を写した後に現れたファイルを読む。
    productionServer(liveLogsPort, {
      claude: path.join(liveLogsDirectory, "claude", "projects"),
      codex: path.join(liveLogsDirectory, "codex", "sessions"),
    }),
  ],
});
