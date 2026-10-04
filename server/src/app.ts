import { Hono } from "hono";
import { decodeTimelineCursor, type LogRoots, readThread, readTimeline } from "./timeline.js";

// タイムラインの 1 画面に並ぶ件数より多く、1 回の応答でログを読む量を抑えられる件数にするため。
const timelineDefaultLimit = 50;
// 画面が一度に描く件数として十分で、1 回の応答が大きくなりすぎない上限にするため。
const timelineMaxLimit = 200;

/** agent-timeline の HTTP API を返す。静的ファイルの配信と待ち受けを含まないため、テストから直接呼べる。 */
export function createApp(logRoots: LogRoots): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  // 全セッションの投稿を新しい順に返す。`limit` は件数の上限、`cursor` は直前の応答の `nextCursor`。
  app.get("/api/posts", async (c) => {
    const limitText = c.req.query("limit");
    const limit = limitText === undefined ? timelineDefaultLimit : Number(limitText);
    if (!Number.isInteger(limit) || limit < 1 || limit > timelineMaxLimit) {
      return c.json({ error: `limit は 1 から ${timelineMaxLimit} の整数で指定する` }, 400);
    }
    const cursorText = c.req.query("cursor");
    const cursor = cursorText === undefined ? null : decodeTimelineCursor(cursorText);
    if (cursorText !== undefined && cursor === null) {
      return c.json({ error: "cursor が読めない" }, 400);
    }
    return c.json(await readTimeline(logRoots, { limit, cursor }));
  });

  // 1 つのセッションの投稿を古い順に返す。
  app.get("/api/sessions/:agent/:sessionId/posts", async (c) => {
    const agent = c.req.param("agent");
    if (agent !== "claude-code" && agent !== "codex") {
      return c.json({ error: "セッションが見つからない" }, 404);
    }
    const posts = await readThread(logRoots, agent, c.req.param("sessionId"));
    if (posts === null) {
      return c.json({ error: "セッションが見つからない" }, 404);
    }
    return c.json({ posts });
  });

  return app;
}
