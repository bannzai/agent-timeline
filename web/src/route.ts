import type { AgentKind, PostSession } from "../../server/src/post.js";

/** 画面の場所。home はタイムライン、thread は 1 つのセッションのスレッド。 */
export type Route = { screen: "home" } | { screen: "thread"; agent: AgentKind; sessionId: string };

/** スレッドの URL のパス。スレッドの API (`/api/sessions/:agent/:sessionId/posts`) と同じ並びでセッションを指す。 */
const threadPathPattern = /^\/sessions\/([^/]+)\/([^/]+)\/?$/;

/** セッションのスレッドの URL のパスを返す。 */
export function threadPath(session: Pick<PostSession, "agent" | "sessionId">): string {
  return `/sessions/${session.agent}/${encodeURIComponent(session.sessionId)}`;
}

/** URL のパスを画面の場所にする。スレッドのパスとして読めなければタイムラインを返す。 */
export function routeFromPath(pathname: string): Route {
  const [, agent, encodedSessionId] = threadPathPattern.exec(pathname) ?? [];
  if ((agent !== "claude-code" && agent !== "codex") || encodedSessionId === undefined) {
    return { screen: "home" };
  }
  try {
    return { screen: "thread", agent, sessionId: decodeURIComponent(encodedSessionId) };
  } catch {
    // `%` の後が 16 進数でないパスは decodeURIComponent が投げる。セッションを指していないため、タイムラインにする。
    return { screen: "home" };
  }
}
