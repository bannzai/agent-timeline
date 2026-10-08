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
 * Claude Code が user の行として書く、人間が agent に向けて書いたのではない文の書き出し。2026-09〜10 の Claude Code
 * (2.1.179〜2.1.294) のログで、isMeta の付かない user の行の先頭に現れたものを集めた (一覧と件数は
 * documents/PROJECT.md「投稿にしない行」)。人間が書いた文 (`<div>` や `<pasted_content>` で始まる指示など) を
 * 落とさないよう、既知のものに限る。
 */
const nonHumanTextPrefixes = [
  // バックグラウンドの処理の完了通知
  "<task-notification",
  // Claude Code が手元で処理するコマンド (`/usage`・`/login` など) とその出力。agent には届かない。
  // skill の起動の行 (`<command-message>` で始まる) は別に扱う (skillLaunchPostText)
  "<command-name>",
  "<local-command-stdout",
  // 人が `!` で実行したシェルのコマンドと出力。agent への指示ではない
  "<bash-input",
  "<bash-stdout",
  "<bash-stderr",
  // 人が処理を中断した通知 (`[Request interrupted by user]`・`[Request interrupted by user for tool use]`)。本文が無い
  "[Request interrupted by user",
  // 人の入力ではないとラベルの付いた通知
  "[SYSTEM NOTIFICATION",
  // 別のセッション (サブエージェント・teammate) からの報告の転送。この行への agent の返答は assistant の行に残る
  "Another Claude session sent a message",
];

/** `<system-reminder>` だけの文。人間の文に添えられた注意ではなく、注意だけの行。 */
const systemReminderOnlyText = /^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/;

/** 画像の添付の印 (`[Image #1]`) だけの文。文に添えられている時は印を残す。 */
const imageMarksOnlyText = /^(\s*\[Image #\d+\])+\s*$/;

/**
 * skill (`/foo 引数`) を起動した時に Claude Code が書く行の、人が打った 1 行。行は `<command-message>` で始まり、
 * `<command-name>` と `<command-args>` を持つ。展開された SKILL.md の本文は isMeta の行に書かれ、ここには無い。
 * `<command-name>` が無ければ null を返す。
 */
function skillLaunchPostText(text: string): string | null {
  const commandName = /<command-name>([^<]*)<\/command-name>/.exec(text)?.[1]?.trim();
  if (commandName === undefined || commandName === "") {
    return null;
  }
  const commandArgs = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim() ?? "";
  return commandArgs === "" ? commandName : `${commandName} ${commandArgs}`;
}

/**
 * user の行の文を、人間の指示の投稿の本文にする。人間が agent に向けて書いた文でなければ null を返す。
 * skill の起動の行は、人が打った `/foo 引数` の 1 行にする。
 */
function humanPostText(text: string): string | null {
  const trimmedText = text.trimStart();
  if (trimmedText.startsWith("<command-message>")) {
    return skillLaunchPostText(text);
  }
  if (
    nonHumanTextPrefixes.some((prefix) => trimmedText.startsWith(prefix)) ||
    systemReminderOnlyText.test(text) ||
    imageMarksOnlyText.test(text)
  ) {
    return null;
  }
  return text;
}

/** 書き手が author の文を投稿の本文にする。空の文と、人間の行に Claude Code が書いた文は投稿にせず null を返す。 */
function postText(text: string, author: PostAuthor): string | null {
  if (text.trim() === "") {
    return null;
  }
  return author === "human" ? humanPostText(text) : text;
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
      const text = postText(content, textAuthor);
      if (text !== null) {
        posts.push({
          id: postId("claude-code", sessionId, lineIndex, 0),
          session,
          author: textAuthor,
          text,
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
      const text =
        block.type === "text" && typeof block.text === "string"
          ? postText(block.text, textAuthor)
          : null;
      if (text !== null) {
        posts.push({
          id,
          session,
          author: textAuthor,
          text,
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
