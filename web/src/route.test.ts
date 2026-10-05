import { describe, expect, it } from "vitest";
import { type Route, routeFromPath, routePath, threadPath } from "./route";

describe("routeFromPath", () => {
  it("threadPath が作ったパスを同じセッションのスレッドに戻す", () => {
    const session = { agent: "codex" as const, sessionId: "rollout id/with slash" };

    expect(routeFromPath(threadPath(session))).toEqual({ screen: "thread", ...session });
  });

  it.each<Route>([
    { screen: "home" },
    { screen: "project", projectName: "acme-shop" },
    { screen: "worktree", projectName: "acme-shop", worktreeName: "fix-tax-rounding" },
    { screen: "worktree", projectName: "名前 with/slash", worktreeName: "feature/cart total" },
    { screen: "thread", agent: "claude-code", sessionId: "3f2a9c1e-5b7d-4e8a-9c6f-1a2b3c4d5e6f" },
  ])("routePath が作ったパスを同じ場所 %o に戻す", (route) => {
    expect(routeFromPath(routePath(route))).toEqual(route);
  });

  it.each([
    "/",
    "/sessions/gemini/abc",
    "/sessions/codex",
    "/sessions/codex/%E0%A4%A",
    "/projects",
    "/projects/acme-shop/worktrees",
    "/projects/%E0%A4%A",
  ])("画面の場所を指さない %s はタイムラインにする", (pathname) => {
    expect(routeFromPath(pathname)).toEqual({ screen: "home" });
  });
});
