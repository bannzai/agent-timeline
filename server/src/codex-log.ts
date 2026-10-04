import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  isRecord,
  parseJson,
  type Post,
  type PostAuthor,
  postId,
  postTimestamp,
  type SessionLogFile,
  toolCallText,
} from "./post.js";

// Codex のログの形式の知識は、このファイルの中だけに置く (documents/PROJECT.md「入力」)。

/** ファイル名 `rollout-<日時>-<セッション ID>.jsonl` の末尾のセッション ID (36 文字の UUID)。 */
const sessionIdInFileName = /-([0-9a-f-]{36})\.jsonl$/i;

/** message の role ごとの投稿の書き手。developer は Codex が agent に渡す指示で、人間の指示ではないため含めない。 */
const messageAuthors = new Map<unknown, PostAuthor>([
  ["user", "human"],
  ["assistant", "agent"],
]);

/** ログのファイル名からセッション ID を取る。ID の形でなければ、拡張子を除いたファイル名をそのまま使う。 */
function codexSessionId(fileName: string): string {
  return sessionIdInFileName.exec(fileName)?.[1] ?? path.basename(fileName, ".jsonl");
}

/**
 * `<sessionsDirectory>/<年>/<月>/<日>/rollout-*.jsonl` のログのファイルを返す。
 * ディレクトリが無い時 (Codex を使っていないマシン) は空の配列を返す。
 */
export async function listCodexSessionLogFiles(
  sessionsDirectory: string,
): Promise<SessionLogFile[]> {
  const relativePaths = await readdir(sessionsDirectory, { recursive: true }).catch(() => []);
  return relativePaths
    .filter((relativePath) => /^rollout-.*\.jsonl$/.test(path.basename(relativePath)))
    .map((relativePath) => ({
      agent: "codex" as const,
      sessionId: codexSessionId(path.basename(relativePath)),
      path: path.join(sessionsDirectory, relativePath),
    }));
}

/**
 * Codex が人間の指示の message に差し込む文脈の書き出し。2026-08〜10 の Codex のログで、user の message の
 * 要素の先頭に現れたものを集めた。人間が書いた文 (`<div>` で始まる指示など) を落とさないよう、既知のものに限る。
 */
const injectedContextPrefixes = [
  "<environment_context>",
  "# AGENTS.md instructions",
  "<skill>",
  "<recommended_plugins>",
  "<hook_prompt ",
  "<codex_internal_context ",
  "<no retained transcript delta entries>",
];

/** Codex が人間の指示の message に差し込んだ文脈か。 */
function isInjectedContext(text: string): boolean {
  return injectedContextPrefixes.some((prefix) => text.trimStart().startsWith(prefix));
}

/** message の content の要素の文。文を持たない要素は null を返す。 */
function contentItemText(item: unknown): string | null {
  return isRecord(item) && typeof item.text === "string" ? item.text : null;
}

/**
 * Codex のセッションのログ (JSONL の全文) を、古い順の投稿にする。
 * 人間の指示・agent の返答・ツール呼び出しだけを投稿にし、読めない行と知らない種類の行は読み飛ばす。
 */
export function parseCodexSessionLog(sessionId: string, logText: string): Post[] {
  const posts: Post[] = [];
  // 作業ディレクトリとブランチは、セッションの始めの session_meta の行だけが持つ。
  let projectDirectory: string | null = null;
  let gitBranch: string | null = null;

  logText.split("\n").forEach((line, lineIndex) => {
    const entry = parseJson(line);
    if (!isRecord(entry) || !isRecord(entry.payload)) {
      return;
    }
    const payload = entry.payload;
    if (entry.type === "session_meta") {
      if (typeof payload.cwd === "string") {
        projectDirectory = payload.cwd;
      }
      if (isRecord(payload.git) && typeof payload.git.branch === "string") {
        gitBranch = payload.git.branch;
      }
      return;
    }
    // event_msg・reasoning・ツールの結果などは投稿にしない。
    if (entry.type !== "response_item") {
      return;
    }
    const timestamp = postTimestamp(entry.timestamp);
    if (timestamp === null) {
      return;
    }
    const id = postId("codex", sessionId, lineIndex, 0);
    const session = { agent: "codex" as const, sessionId, projectDirectory, gitBranch };

    if (payload.type === "message") {
      const author = messageAuthors.get(payload.role);
      if (author === undefined || !Array.isArray(payload.content)) {
        return;
      }
      const text = payload.content
        .map(contentItemText)
        .filter((itemText) => itemText !== null)
        .filter((itemText) => author === "agent" || !isInjectedContext(itemText))
        .join("\n\n");
      if (text.trim() !== "") {
        posts.push({ id, session, author, text, timestamp });
      }
    } else if (payload.type === "custom_tool_call" || payload.type === "function_call") {
      // custom_tool_call は引数を input に、function_call は JSON の文字列を arguments に持つ。
      const toolInput = payload.type === "custom_tool_call" ? payload.input : payload.arguments;
      if (typeof payload.name === "string" && typeof toolInput === "string") {
        posts.push({
          id,
          session,
          author: "tool",
          text: toolCallText(payload.name, toolInput),
          timestamp,
        });
      }
    }
  });

  return posts;
}
