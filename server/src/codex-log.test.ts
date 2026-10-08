import { describe, expect, it } from "vitest";
import { parseCodexSessionLog } from "./codex-log.js";

/** Codex のログの session_meta の行。source は、セッションを始めたもの (`cli` や `{ subagent: ... }`)。 */
function sessionMetaLine(source: unknown): string {
  return JSON.stringify({
    timestamp: "2026-10-01T09:00:00.000Z",
    type: "session_meta",
    payload: { id: "session", cwd: "/home/dev/weather-cli", source },
  });
}

/** Codex のログの、人間の message の行。 */
function userMessageLine(text: string): string {
  return JSON.stringify({
    timestamp: "2026-10-01T09:00:01.000Z",
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  });
}

describe("parseCodexSessionLog のサブエージェントのセッション", () => {
  it.each([
    ["承認の判定 (guardian)", { subagent: { other: "guardian" } }],
    ["並列の作業に spawn したスレッド", { subagent: { thread_spawn: { depth: 1 } } }],
  ])("%s のセッションは投稿を持たない", (_, source) => {
    const logText = [sessionMetaLine(source), userMessageLine("[1] user: 架空の会話の写し")].join(
      "\n",
    );

    expect(parseCodexSessionLog("session", logText)).toEqual([]);
  });

  it.each([
    ["対話 (cli)", "cli"],
    ["エディタ (vscode)", "vscode"],
    ["codex exec", "exec"],
    ["source が無い古い形", undefined],
  ])("人間が始めたセッション (%s) の指示は投稿にする", (_, source) => {
    const logText = [sessionMetaLine(source), userMessageLine("週間予報を足して")].join("\n");

    expect(parseCodexSessionLog("session", logText).map((post) => post.text)).toEqual([
      "週間予報を足して",
    ]);
  });
});
