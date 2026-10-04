import os from "node:os";
import path from "node:path";

/**
 * E2E のサーバーが使う偽の tmux (fixtures/fake-commands/tmux.mjs) が、呼ばれるたびに引数を書くファイル。
 * テストはこれを読み、返信の本文が pane へ送られたことを確かめる。runner のリポジトリを汚さないため、一時ディレクトリに置く。
 */
export const fakeTmuxCallsFile = path.join(os.tmpdir(), "agent-timeline-e2e", "tmux-calls.jsonl");
