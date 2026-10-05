import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/src/**/*.test.ts", "web/src/**/*.test.{ts,tsx}"],
    // 本物のホームディレクトリのログではなく、手書きの合成セッションを読む (.claude/rules/synthetic-fixtures.md)。
    // `npm test` はリポジトリのルートで実行され、サーバーは相対パスを作業ディレクトリから解決する。
    // 返信は本物の tmux ではなく偽の tmux と ps に送る (fixtures/fake-commands/README.md)。
    env: {
      AGENT_TIMELINE_CLAUDE_PROJECTS_DIR: "fixtures/claude/projects",
      AGENT_TIMELINE_CODEX_SESSIONS_DIR: "fixtures/codex/sessions",
      AGENT_TIMELINE_TMUX: "fixtures/fake-commands/tmux.mjs",
      AGENT_TIMELINE_PS: "fixtures/fake-commands/ps.mjs",
    },
  },
});
