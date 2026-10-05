import type { MouseEvent } from "react";
import type { AgentKind, PostSession } from "../../server/src/post.js";

/**
 * 画面の場所。home はタイムライン、project はプロジェクトのページ、worktree は worktree のページ、
 * thread は 1 つのセッションのスレッド。
 */
export type Route =
  | { screen: "home" }
  | { screen: "project"; projectName: string }
  | { screen: "worktree"; projectName: string; worktreeName: string }
  | { screen: "thread"; agent: AgentKind; sessionId: string };

/** スレッドの URL のパス。スレッドの API (`/api/sessions/:agent/:sessionId/posts`) と同じ並びでセッションを指す。 */
const threadPathPattern = /^\/sessions\/([^/]+)\/([^/]+)\/?$/;
/** プロジェクトのページ (`/projects/<プロジェクト>`) と worktree のページ (`/projects/<プロジェクト>/worktrees/<worktree>`) の URL のパス。 */
const projectPathPattern = /^\/projects\/([^/]+)(?:\/worktrees\/([^/]+))?\/?$/;

/** セッションのスレッドの URL のパスを返す。 */
export function threadPath(session: Pick<PostSession, "agent" | "sessionId">): string {
  return `/sessions/${session.agent}/${encodeURIComponent(session.sessionId)}`;
}

/** 画面の場所の URL のパスを返す。 */
export function routePath(route: Route): string {
  switch (route.screen) {
    case "home":
      return "/";
    case "project":
      return `/projects/${encodeURIComponent(route.projectName)}`;
    case "worktree":
      return `/projects/${encodeURIComponent(route.projectName)}/worktrees/${encodeURIComponent(route.worktreeName)}`;
    case "thread":
      return threadPath(route);
  }
}

/** URL のパスを画面の場所にする。スレッドとプロジェクトのパスとして読めなければタイムラインを返す。 */
export function routeFromPath(pathname: string): Route {
  try {
    const [, agent, encodedSessionId] = threadPathPattern.exec(pathname) ?? [];
    if ((agent === "claude-code" || agent === "codex") && encodedSessionId !== undefined) {
      return { screen: "thread", agent, sessionId: decodeURIComponent(encodedSessionId) };
    }
    const [, encodedProjectName, encodedWorktreeName] = projectPathPattern.exec(pathname) ?? [];
    if (encodedProjectName !== undefined) {
      const projectName = decodeURIComponent(encodedProjectName);
      return encodedWorktreeName === undefined
        ? { screen: "project", projectName }
        : {
            screen: "worktree",
            projectName,
            worktreeName: decodeURIComponent(encodedWorktreeName),
          };
    }
  } catch {
    // `%` の後が 16 進数でないパスは decodeURIComponent が投げる。画面の場所を指していないため、タイムラインにする。
  }
  return { screen: "home" };
}

/** アプリの中の画面へのリンクを押した時の処理。修飾キー付きのクリックはブラウザの既定 (新しいタブで開くなど) に任せ、それ以外はページを読み直さず open を呼ぶ。 */
export function handleInAppLinkClick(event: MouseEvent, open: () => void): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  open();
}
