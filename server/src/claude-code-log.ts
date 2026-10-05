import { readdir } from "node:fs/promises";
import path from "node:path";
import { findInLogLines } from "./log-file.js";
import {
  isRecord,
  parseJson,
  type Post,
  type PostAuthor,
  postId,
  postTimestamp,
  type SessionLogFile,
  type SessionStart,
  toolCallText,
  toolResultText,
} from "./post.js";

// Claude Code のログの形式の知識は、このファイルの中だけに置く (documents/PROJECT.md「入力」)。

/**
 * Claude Code が user の行として書く、人間が書いたのではない文の書き出し。2026-09〜10 の Claude Code のログで、
 * isMeta の付かない user の行の先頭に現れたものを集めた。人間が書いた文 (`<div>` で始まる指示など) と、
 * 人間が打ったスラッシュコマンド (`<command-name>`)・シェルのコマンド (`<bash-input>`) は残す。
 */
const nonHumanTextPrefixes = ["<task-notification", "<local-command-stdout", "<bash-stdout"];

/** 書き手が author の文を投稿にするか。空の文と、人間の行に Claude Code が書いた文は投稿にしない。 */
function isPostText(text: string, author: PostAuthor): boolean {
  if (text.trim() === "") {
    return false;
  }
  return author !== "human" || !nonHumanTextPrefixes.some((prefix) => text.startsWith(prefix));
}

/**
 * projectsDirectory からの相対パスが `<プロジェクトの slug>/<セッション ID>.jsonl` の形なら、そのログのファイルを返す。
 * subagent のログは `<セッション ID>/subagents/` の下にあり、セッションの会話ではないため null を返す。
 * ファイルかどうかは見ない。
 */
export function claudeCodeSessionLogFileAt(
  projectsDirectory: string,
  relativePath: string,
): SessionLogFile | null {
  if (relativePath.split(path.sep).length !== 2 || !relativePath.endsWith(".jsonl")) {
    return null;
  }
  return {
    agent: "claude-code",
    sessionId: path.basename(relativePath, ".jsonl"),
    path: path.join(projectsDirectory, relativePath),
  };
}

/**
 * `<projectsDirectory>/<プロジェクトの slug>/<セッション ID>.jsonl` のログのファイルを返す。
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
      if (!logEntry.isFile()) {
        continue;
      }
      const sessionLogFile = claudeCodeSessionLogFileAt(
        projectsDirectory,
        path.join(projectEntry.name, logEntry.name),
      );
      if (sessionLogFile !== null) {
        sessionLogFiles.push(sessionLogFile);
      }
    }
  }
  return sessionLogFiles;
}

/** セッションを始めた時の作業ディレクトリとブランチを、cwd を持つ最初の行から読む。cwd を持つ行がまだ無ければ null を返す。 */
export function readClaudeCodeSessionStart(logPath: string): Promise<SessionStart | null> {
  return findInLogLines(logPath, (entry) =>
    isRecord(entry) && typeof entry.cwd === "string"
      ? {
          projectDirectory: entry.cwd,
          gitBranch: typeof entry.gitBranch === "string" ? entry.gitBranch : null,
        }
      : null,
  );
}

/**
 * ログのディレクトリ (プロジェクトの slug) ごとの、セッションを始めた作業ディレクトリ。Claude Code は始めた作業ディレクトリから
 * slug を作るため、同じ slug のセッションは同じ作業ディレクトリで始まる。数万のセッションのログの先頭を全て読まずに済ませるため覚えておく。
 */
const startDirectoriesBySlugDirectory = new Map<string, string>();

/** セッションを始めた作業ディレクトリを返す。同じ slug のログを一度読んだ後は、ログを読まずに返す。分からなければ null を返す。 */
export async function readClaudeCodeSessionStartDirectory(logPath: string): Promise<string | null> {
  const slugDirectory = path.dirname(logPath);
  const knownStartDirectory = startDirectoriesBySlugDirectory.get(slugDirectory);
  if (knownStartDirectory !== undefined) {
    return knownStartDirectory;
  }
  const startDirectory = (await readClaudeCodeSessionStart(logPath))?.projectDirectory ?? null;
  if (startDirectory !== null) {
    startDirectoriesBySlugDirectory.set(slugDirectory, startDirectory);
  }
  return startDirectory;
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
  // tool_result は、呼び出しの tool_use の id を tool_use_id に持つ。結果を呼び出しの投稿の toolResult に入れるため、id から引く。
  const toolPostsByToolUseId = new Map<string, Post>();

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
    // isMeta は Claude Code が差し込んだ文、isSidechain は subagent の会話、isCompactSummary は会話の圧縮で
    // Claude Code が書いた要約で、どれも人間とのやり取りではない。
    if (entry.isMeta === true || entry.isSidechain === true || entry.isCompactSummary === true) {
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
      if (isPostText(content, textAuthor)) {
        posts.push({
          id: postId("claude-code", sessionId, lineIndex, 0),
          session,
          author: textAuthor,
          text: content,
          toolResult: null,
          timestamp,
        });
      }
      return;
    }
    if (!Array.isArray(content)) {
      return;
    }
    // thinking は投稿にしない。tool_result (user の行に入るツールの結果) は、呼び出しの投稿に入れる。
    content.forEach((block: unknown, blockIndex) => {
      if (!isRecord(block)) {
        return;
      }
      const id = postId("claude-code", sessionId, lineIndex, blockIndex);
      if (
        block.type === "text" &&
        typeof block.text === "string" &&
        isPostText(block.text, textAuthor)
      ) {
        posts.push({
          id,
          session,
          author: textAuthor,
          text: block.text,
          toolResult: null,
          timestamp,
        });
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        const toolPost: Post = {
          id,
          session,
          author: "tool",
          text: toolCallText(block.name, JSON.stringify(block.input ?? {})),
          toolResult: null,
          timestamp,
        };
        posts.push(toolPost);
        if (typeof block.id === "string") {
          toolPostsByToolUseId.set(block.id, toolPost);
        }
      } else if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        const toolPost = toolPostsByToolUseId.get(block.tool_use_id);
        if (toolPost !== undefined) {
          toolPost.toolResult = toolResultText(block.content);
        }
      }
    });
  });

  return posts;
}
