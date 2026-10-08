import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  listClaudeCodeSessionLogFiles,
  parseClaudeCodeSessionLog,
  readClaudeCodeSessionStart,
  readClaudeCodeSessionStartDirectory,
} from "./claude-code-log.js";
import {
  listCodexSessionLogFiles,
  parseCodexSessionLog,
  readCodexSessionStart,
} from "./codex-log.js";
import {
  type AgentKind,
  compareNewestFirst,
  compareText,
  parseJson,
  type Post,
  type PostAuthor,
  type SessionLogFile,
  type SessionStart,
  type TimelinePage,
} from "./post.js";
import {
  type Checkout,
  checkoutOfDirectory,
  isCheckoutInFilter,
  type Project,
  type TimelineFilter,
  type Worktree,
} from "./project.js";

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

/** ログのファイルのパスごとの、セッションを始めた時の作業ディレクトリとブランチ。ログは追記だけされ先頭の行は変わらないため、読んだものを覚えておく。 */
const sessionStartsByLogPath = new Map<string, SessionStart>();

/** セッションを始めた時の作業ディレクトリとブランチを返す。まだログに書かれていなければ null を返す。 */
async function readSessionStart(sessionLogFile: SessionLogFile): Promise<SessionStart | null> {
  const knownSessionStart = sessionStartsByLogPath.get(sessionLogFile.path);
  if (knownSessionStart !== undefined) {
    return knownSessionStart;
  }
  const sessionStart =
    sessionLogFile.agent === "claude-code"
      ? await readClaudeCodeSessionStart(sessionLogFile.path)
      : await readCodexSessionStart(sessionLogFile.path);
  if (sessionStart !== null) {
    sessionStartsByLogPath.set(sessionLogFile.path, sessionStart);
  }
  return sessionStart;
}

/**
 * セッションが属する checkout を、セッションを始めた作業ディレクトリから返す。分からなければ null を返す。
 * セッションがどのプロジェクトと worktree のものかは、この checkout で決める (documents/PROJECT.md「プロジェクトと worktree」)。
 */
async function readSessionCheckout(sessionLogFile: SessionLogFile): Promise<Checkout | null> {
  return checkoutOfDirectory(
    sessionLogFile.agent === "claude-code"
      ? await readClaudeCodeSessionStartDirectory(sessionLogFile.path)
      : ((await readSessionStart(sessionLogFile))?.projectDirectory ?? null),
  );
}

/**
 * 全セッションの投稿を新しい順に、cursor より古いものから最大 limit 件返す。
 * filter を渡すと、そのプロジェクトか worktree のセッションの投稿だけを返す。
 * authors を渡すと、その書き手の投稿だけを返す (ページの件数は、絞った後の投稿で数える)。
 */
export async function readTimeline(
  logRoots: LogRoots,
  {
    limit,
    cursor,
    filter,
    authors,
  }: {
    limit: number;
    cursor: TimelineCursor | null;
    filter?: TimelineFilter;
    authors?: ReadonlySet<PostAuthor>;
  },
): Promise<TimelinePage> {
  // ファイルの中の投稿の日時は、そのファイルの最終更新の日時を超えない。そこで最終更新が新しい順に読み、
  // 残りのファイルにページへ入る投稿が無いと分かった時点で読むのをやめる。
  const sessionLogFiles: { sessionLogFile: SessionLogFile; modifiedAt: string }[] = [];
  for (const sessionLogFile of await listSessionLogFiles(logRoots)) {
    if (
      filter !== undefined &&
      !isCheckoutInFilter(await readSessionCheckout(sessionLogFile), filter)
    ) {
      continue;
    }
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
      .filter((post) => authors === undefined || authors.has(post.author))
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

/**
 * ログがあるプロジェクトを、最近使った順に返す。最近使ったかは、投稿を読まずにログのファイルの最終更新で決める。
 * 作業ディレクトリが分からないセッションは含めない。
 */
export async function readProjects(logRoots: LogRoots): Promise<Project[]> {
  // プロジェクトと worktree の名前ごとの、最終更新が最も新しいセッションのログのファイル。
  const newestSessions = new Map<
    string,
    { checkout: Checkout; sessionLogFile: SessionLogFile; modifiedAt: string }
  >();
  for (const sessionLogFile of await listSessionLogFiles(logRoots)) {
    const checkout = await readSessionCheckout(sessionLogFile);
    const fileStats = checkout === null ? null : await stat(sessionLogFile.path).catch(() => null);
    if (checkout === null || fileStats === null) {
      continue;
    }
    const modifiedAt = fileStats.mtime.toISOString();
    const worktreeKey = JSON.stringify([checkout.projectName, checkout.worktreeName]);
    const newestSession = newestSessions.get(worktreeKey);
    if (newestSession === undefined || newestSession.modifiedAt < modifiedAt) {
      newestSessions.set(worktreeKey, { checkout, sessionLogFile, modifiedAt });
    }
  }

  const worktreesByProjectName = new Map<string, Worktree[]>();
  for (const { checkout, sessionLogFile, modifiedAt } of newestSessions.values()) {
    const { projectName, ...worktreeCheckout } = checkout;
    worktreesByProjectName.set(projectName, [
      ...(worktreesByProjectName.get(projectName) ?? []),
      {
        ...worktreeCheckout,
        gitBranch: (await readSessionStart(sessionLogFile))?.gitBranch ?? null,
        lastActiveAt: modifiedAt,
      },
    ]);
  }
  // 最終更新が同じ時は名前の順にし、同じログから毎回同じ並びを返す。
  const compareRecentFirst = (a: Worktree, b: Worktree) =>
    compareText(b.lastActiveAt, a.lastActiveAt) || compareText(a.worktreeName, b.worktreeName);
  return [...worktreesByProjectName]
    .map(([projectName, worktrees]) => ({
      projectName,
      worktrees: worktrees.sort(compareRecentFirst),
    }))
    .sort(
      (a, b) =>
        compareText(b.worktrees[0]?.lastActiveAt ?? "", a.worktrees[0]?.lastActiveAt ?? "") ||
        compareText(a.projectName, b.projectName),
    );
}
