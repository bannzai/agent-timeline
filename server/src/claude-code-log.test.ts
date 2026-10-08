import { describe, expect, it } from "vitest";
import { parseClaudeCodeSessionLog } from "./claude-code-log.js";

/** Claude Code が user の行として書く 1 行。fixture と同じく、読み取りが使うキーだけを持つ。 */
function userLine(content: unknown): string {
  return JSON.stringify({
    type: "user",
    timestamp: "2026-09-30T08:00:00.000Z",
    cwd: "/home/dev/notes-app",
    gitBranch: "main",
    message: { role: "user", content },
  });
}

/** 1 行のログを投稿にした時の本文。投稿にならない時は空の配列。 */
function humanPostTexts(content: unknown): string[] {
  return parseClaudeCodeSessionLog("session", userLine(content)).map((post) => post.text);
}

describe("parseClaudeCodeSessionLog の人間の行", () => {
  it("skill の起動の行は、人が打った `/foo 引数` の 1 行の投稿にする", () => {
    expect(
      humanPostTexts(
        "<command-message>fix-tests</command-message>\n<command-name>/fix-tests</command-name>\n<command-args>--all</command-args>",
      ),
    ).toEqual(["/fix-tests --all"]);
    // 引数が無い起動は、コマンドの名前だけにする。
    expect(
      humanPostTexts(
        "<command-message>commit</command-message>\n<command-name>/commit</command-name>\n<command-args></command-args>",
      ),
    ).toEqual(["/commit"]);
    // 配列の text のブロックに書かれた起動も同じ。
    expect(
      humanPostTexts([
        {
          type: "text",
          text: "<command-message>read-issue</command-message>\n<command-name>/read-issue</command-name>\n<command-args>31</command-args>",
        },
      ]),
    ).toEqual(["/read-issue 31"]);
    // `<` を含む引数も、閉じるタグまでを引数として残す。
    expect(
      humanPostTexts(
        "<command-message>fix</command-message>\n<command-name>/fix</command-name>\n<command-args><div> の余白を直して</command-args>",
      ),
    ).toEqual(["/fix <div> の余白を直して"]);
    // `<command-name>` を持たない起動の行は、何を打ったか分からないため投稿にしない。
    expect(humanPostTexts("<command-message>broken</command-message>")).toEqual([]);
  });

  it("Claude Code が手元で処理するコマンド (`<command-name>` で始まる行) は投稿にしない", () => {
    expect(
      humanPostTexts(
        "<command-name>/usage</command-name>\n<command-message>usage</command-message>\n<command-args></command-args>",
      ),
    ).toEqual([]);
  });

  it.each([
    ["中断の通知", "[Request interrupted by user]"],
    ["ツール呼び出しの中断の通知", "[Request interrupted by user for tool use]"],
    ["`!` で実行したシェルのコマンド", "<bash-input>npm test</bash-input>"],
    ["`!` で実行したシェルの出力", "<bash-stdout>ok</bash-stdout><bash-stderr></bash-stderr>"],
    ["人の入力ではない通知", "[SYSTEM NOTIFICATION - NOT USER INPUT]\n架空の通知"],
    ["注意だけの行", "<system-reminder>\n架空の注意\n</system-reminder>"],
    [
      "注意が 2 つだけの行",
      "<system-reminder>注意 1</system-reminder>\n\n<system-reminder>注意 2</system-reminder>",
    ],
    ["別のセッションからの報告の転送", "Another Claude session sent a message:\n架空の報告"],
    ["画像の印だけの行", "[Image #1]"],
    ["複数の画像の印だけの行", "[Image #1] [Image #2]\n"],
    ["空白だけの行", " \n"],
  ])("%s は投稿にしない", (_, content) => {
    expect(humanPostTexts(content)).toEqual([]);
    expect(humanPostTexts([{ type: "text", text: content }])).toEqual([]);
  });

  it.each([
    ["画像の印に添えた文は印ごと残す", "[Image #1]\n\nこの画面を直して"],
    [
      "注意に続く人間の文は残す",
      "<system-reminder>\n架空の注意\n</system-reminder>\nテストも足して",
    ],
    [
      "注意に挟まれた人間の文は残す",
      "<system-reminder>注意 1</system-reminder>修正して<system-reminder>注意 2</system-reminder>",
    ],
    ["`<` で始まる人間の文は残す", "<div> の余白を直して"],
    ["貼り付けた文は残す", '<pasted_content id="0000">\n架空の貼り付け\n</pasted_content>\n直して'],
  ])("%s", (_, content) => {
    expect(humanPostTexts(content)).toEqual([content]);
  });

  it("agent の行は文をそのまま投稿にする", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-09-30T08:00:01.000Z",
      cwd: "/home/dev/notes-app",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "[Image #1] を確認しました" }],
      },
    });

    expect(parseClaudeCodeSessionLog("session", line).map((post) => post.text)).toEqual([
      "[Image #1] を確認しました",
    ]);
  });
});
