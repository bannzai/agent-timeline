import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listClaudeCodeSessionLogFiles, parseClaudeCodeSessionLog } from "./claude-code-log.js";
import { listCodexSessionLogFiles, parseCodexSessionLog } from "./codex-log.js";
import {
  type AgentKind,
  compareNewestFirst,
  compareText,
  parseJson,
  type Post,
  type SessionLogFile,
  type TimelinePage,
} from "./post.js";

/** agent ごとのセッションのログのルートディレクトリ。 */
export interface LogRoots {
  claudeCodeProjectsDirectory: string;
  codexSessionsDirectory: string;
}

/** 一覧の続きを取る位置。直前のページの最後の投稿を指し、それより古い投稿から返す。 */
export interface TimelineCursor {
  timestamp: string;
  id: string;
}

/**
 * 環境変数からログのルートを決める。テストと CI は、ここで fixture のディレクトリに差し替える。
 * 既定は各 agent がセッションのログを書く場所 (documents/PROJECT.md「入力」)。
 */
export function logRootsFromEnv(env: NodeJS.ProcessEnv): LogRoots {
  return {
    claudeCodeProjectsDirectory:
      env.AGENT_TIMELINE_CLAUDE_PROJECTS_DIR ?? path.join(os.homedir(), ".claude", "projects"),
    codexSessionsDirectory:
      env.AGENT_TIMELINE_CODEX_SESSIONS_DIR ?? path.join(os.homedir(), ".codex", "sessions"),
  };
}

/** カーソルを API で受け渡す文字列にする。 */
export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify([cursor.timestamp, cursor.id])).toString("base64url");
}

/** API で受け取った文字列をカーソルに戻す。encodeTimelineCursor が作った形でなければ null を返す。 */
export function decodeTimelineCursor(cursorText: string): TimelineCursor | null {
  const decoded = parseJson(Buffer.from(cursorText, "base64url").toString("utf8"));
  if (!Array.isArray(decoded) || decoded.length !== 2) {
    return null;
  }
  const [timestamp, id] = decoded;
  return typeof timestamp === "string" && typeof id === "string" ? { timestamp, id } : null;
}

/** 両方の agent のセッションのログのファイルを返す。 */
export async function listSessionLogFiles(logRoots: LogRoots): Promise<SessionLogFile[]> {
  const [claudeCodeFiles, codexFiles] = await Promise.all([
    listClaudeCodeSessionLogFiles(logRoots.claudeCodeProjectsDirectory),
    listCodexSessionLogFiles(logRoots.codexSessionsDirectory),
  ]);
  return [...claudeCodeFiles, ...codexFiles];
}

/** 1 つのセッションのログを読み、古い順の投稿を返す。一覧を取った後にファイルが消えていれば空の配列を返す。 */
async function readSessionPosts(sessionLogFile: SessionLogFile): Promise<Post[]> {
  const logText = await readFile(sessionLogFile.path, "utf8").catch(() => "");
  return sessionLogFile.agent === "claude-code"
    ? parseClaudeCodeSessionLog(sessionLogFile.sessionId, logText)
    : parseCodexSessionLog(sessionLogFile.sessionId, logText);
}

/** 全セッションの投稿を新しい順に、cursor より古いものから最大 limit 件返す。 */
export async function readTimeline(
  logRoots: LogRoots,
  { limit, cursor }: { limit: number; cursor: TimelineCursor | null },
): Promise<TimelinePage> {
  // ファイルの中の投稿の日時は、そのファイルの最終更新の日時を超えない。そこで最終更新が新しい順に読み、
  // 残りのファイルにページへ入る投稿が無いと分かった時点で読むのをやめる。
  const sessionLogFiles: { sessionLogFile: SessionLogFile; modifiedAt: string }[] = [];
  for (const sessionLogFile of await listSessionLogFiles(logRoots)) {
    const fileStats = await stat(sessionLogFile.path).catch(() => null);
    if (fileStats !== null) {
      sessionLogFiles.push({ sessionLogFile, modifiedAt: fileStats.mtime.toISOString() });
    }
  }
  sessionLogFiles.sort((a, b) => compareText(b.modifiedAt, a.modifiedAt));

  // 続きの有無を知るため、limit より 1 件多く集める。
  let collectedPosts: Post[] = [];
  for (const [fileIndex, { sessionLogFile }] of sessionLogFiles.entries()) {
    collectedPosts = [...collectedPosts, ...(await readSessionPosts(sessionLogFile))]
      .filter((post) => cursor === null || compareNewestFirst(cursor, post) < 0)
      .sort(compareNewestFirst)
      .slice(0, limit + 1);
    const oldestCollectedPost = collectedPosts[limit];
    const nextFile = sessionLogFiles[fileIndex + 1];
    if (
      oldestCollectedPost !== undefined &&
      nextFile !== undefined &&
      nextFile.modifiedAt < oldestCollectedPost.timestamp
    ) {
      break;
    }
  }

  const pageLastPost = collectedPosts.length > limit ? collectedPosts[limit - 1] : undefined;
  return {
    posts: collectedPosts.slice(0, limit),
    nextCursor: pageLastPost === undefined ? null : encodeTimelineCursor(pageLastPost),
  };
}

/** 1 つのセッションの投稿を古い順に返す。セッションが無ければ null を返す。 */
export async function readThread(
  logRoots: LogRoots,
  agent: AgentKind,
  sessionId: string,
): Promise<Post[] | null> {
  // パスを引数から組み立てず、実在するログのファイルの一覧から選ぶ。`..` を含む ID でルートの外を読ませないため。
  const sessionLogFile = (await listSessionLogFiles(logRoots)).find(
    (file) => file.agent === agent && file.sessionId === sessionId,
  );
  if (sessionLogFile === undefined) {
    return null;
  }
  return (await readSessionPosts(sessionLogFile)).sort((a, b) => compareNewestFirst(b, a));
}
