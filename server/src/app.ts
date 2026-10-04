import { Hono } from "hono";

/** agent-timeline の HTTP API を返す。静的ファイルの配信と待ち受けを含まないため、テストから直接呼べる。 */
export function createApp(): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  return app;
}
