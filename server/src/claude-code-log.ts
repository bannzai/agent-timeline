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

// Claude Code のログの形式の知識は、このファイルの中だけに置く (documents/PROJECT.md「入力」)。

/**
 * `<projectsDirectory>/<プロジェクトの slug>/<セッション ID>.jsonl` のログのファイルを返す。
 * subagent のログは `<セッション ID>/subagents/` の下にあり、セッションの会話ではないため含めない。
 * ディレクトリが無い時 (Claude Code を使っていないマシン) は空の配列を返す。
 */
export async function listClaudeCodeSessionLogFiles(
  projectsDirectory: string,
): Promise<SessionLogFile[]> {
  const sessionLogFiles: SessionLogFile[] = [];
  const projectEntries = await readdir(projectsDirectory, { withFileTypes: true }).catch(() => []);
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) {
      continue;
    }
    const projectDirectory = path.join(projectsDirectory, projectEntry.name);
    const logEntries = await readdir(projectDirectory, { withFileTypes: true }).catch(() => []);
    for (const logEntry of logEntries) {
      if (logEntry.isFile() && logEntry.name.endsWith(".jsonl")) {
        sessionLogFiles.push({
          agent: "claude-code",
          sessionId: path.basename(logEntry.name, ".jsonl"),
          path: path.join(projectDirectory, logEntry.name),
        });
      }
    }
  }
  return sessionLogFiles;
}

/**
 * Claude Code のセッションのログ (JSONL の全文) を、古い順の投稿にする。
 * 人間の指示・agent の返答・ツール呼び出しだけを投稿にし、読めない行と知らない種類の行は読み飛ばす。
 */
export function parseClaudeCodeSessionLog(sessionId: string, logText: string): Post[] {
  const posts: Post[] = [];
  // cwd と gitBranch は各行が持つ。持たない行は、直前の行の値のままとみなす。
  let projectDirectory: string | null = null;
  let gitBranch: string | null = null;

  logText.split("\n").forEach((line, lineIndex) => {
    const entry = parseJson(line);
    if (!isRecord(entry)) {
      return;
    }
    if (typeof entry.cwd === "string") {
      projectDirectory = entry.cwd;
    }
    if (typeof entry.gitBranch === "string") {
      gitBranch = entry.gitBranch;
    }
    if (entry.type !== "user" && entry.type !== "assistant") {
      return;
    }
    // isMeta は Claude Code が差し込んだ文、isSidechain は subagent の会話で、どちらも人間とのやり取りではない。
    if (entry.isMeta === true || entry.isSidechain === true) {
      return;
    }
    const timestamp = postTimestamp(entry.timestamp);
    if (timestamp === null || !isRecord(entry.message)) {
      return;
    }
    const textAuthor: PostAuthor = entry.type === "user" ? "human" : "agent";
    const session = { agent: "claude-code" as const, sessionId, projectDirectory, gitBranch };
    const content = entry.message.content;

    if (typeof content === "string") {
      if (content.trim() !== "") {
        posts.push({
          id: postId("claude-code", sessionId, lineIndex, 0),
          session,
          author: textAuthor,
          text: content,
          timestamp,
        });
      }
      return;
    }
    if (!Array.isArray(content)) {
      return;
    }
    // thinking と tool_result (user の行に入るツールの結果) は投稿にしない。
    content.forEach((block: unknown, blockIndex) => {
      if (!isRecord(block)) {
        return;
      }
      const id = postId("claude-code", sessionId, lineIndex, blockIndex);
      if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
        posts.push({ id, session, author: textAuthor, text: block.text, timestamp });
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        posts.push({
          id,
          session,
          author: "tool",
          text: toolCallText(block.name, JSON.stringify(block.input ?? {})),
          timestamp,
        });
      }
    });
  });

  return posts;
}
