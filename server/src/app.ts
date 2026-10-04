import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createLogWatcher } from "./log-watcher.js";
import { type SessionsChangedEvent, timelineMaxLimit } from "./post.js";
import { decodeTimelineCursor, type LogRoots, readThread, readTimeline } from "./timeline.js";

// タイムラインの 1 画面に並ぶ件数より多く、1 回の応答でログを読む量を抑えられる件数にするため。
const timelineDefaultLimit = 50;
// サーバーは 127.0.0.1 だけで待ち受けるため、正しいリクエストの Host はこのどちらかになる。
const localHostnames = new Set(["127.0.0.1", "localhost"]);
// 発言が 1 秒ほどでタイムラインに流れ、流し見て遅れを感じない間隔にするため。
// 1 回に見るのはファイルの一覧と大きさ・最終更新の日時だけで、ファイルの中身は読まない。
const logPollIntervalMs = 1000;

/** agent-timeline の HTTP API を返す。静的ファイルの配信と待ち受けを含まないため、テストから直接呼べる。 */
export function createApp(logRoots: LogRoots): Hono {
  const app = new Hono();
  const logWatcher = createLogWatcher(logRoots, logPollIntervalMs);

  // 会話のログを返すため、Host がこのマシンでないリクエストは拒否する。ブラウザで開いた別のサイトが
  // 自分のドメインを 127.0.0.1 に向け直して (DNS rebinding) 同じオリジンとして読むのを防ぐ (documents/PROJECT.md「制約」)。
  // @hono/node-server はリクエストの URL を Host ヘッダーから組み立てる。
  app.use("/api/*", async (c, next) => {
    if (!localHostnames.has(new URL(c.req.url).hostname)) {
      return c.json({ error: "Host がこのマシンではない" }, 403);
    }
    await next();
  });

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

  // ログの変化を Server-Sent Events で知らせる。見張りの基準ができた時に `ready` を送り、その後は
  // ログが追記されたか新しく現れたセッションを `sessions-changed` で送る。画面は ready を受けたら読み直し、
  // つながる前とつながっていない間の変化を拾う。
  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const aborted = new Promise<void>((resolve) => stream.onAbort(resolve));
      const unsubscribe = await logWatcher.subscribe((changedSessions) => {
        void stream.writeSSE({
          event: "sessions-changed",
          data: JSON.stringify({ sessions: changedSessions } satisfies SessionsChangedEvent),
        });
      });
      // ブラウザは data が空のイベントを届けないため、空のオブジェクトを入れる。
      await stream.writeSSE({ event: "ready", data: "{}" });
      // コールバックが終わるとつながりが閉じるため、ブラウザが閉じるまで待つ。
      await aborted;
      unsubscribe();
    }),
  );

  return app;
}
