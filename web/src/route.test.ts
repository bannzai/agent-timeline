import { describe, expect, it } from "vitest";
import { routeFromPath, threadPath } from "./route";

describe("routeFromPath", () => {
  it("threadPath が作ったパスを同じセッションのスレッドに戻す", () => {
    const session = { agent: "codex" as const, sessionId: "rollout id/with slash" };

    expect(routeFromPath(threadPath(session))).toEqual({ screen: "thread", ...session });
  });

  it.each(["/", "/sessions/gemini/abc", "/sessions/codex", "/sessions/codex/%E0%A4%A"])(
    "スレッドを指さない %s はタイムラインにする",
    (pathname) => {
      expect(routeFromPath(pathname)).toEqual({ screen: "home" });
    },
  );
});
