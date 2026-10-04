import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/src/**/*.test.ts", "web/src/**/*.test.{ts,tsx}"],
    // 本物のホームディレクトリのログではなく、手書きの合成セッションを読む (.claude/rules/synthetic-fixtures.md)。
    // `npm test` はリポジトリのルートで実行され、サーバーは相対パスを作業ディレクトリから解決する。
    env: {
      AGENT_TIMELINE_CLAUDE_PROJECTS_DIR: "fixtures/claude/projects",
      AGENT_TIMELINE_CODEX_SESSIONS_DIR: "fixtures/codex/sessions",
    },
  },
});
