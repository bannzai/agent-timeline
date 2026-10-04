import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { logRootsFromEnv } from "./timeline.js";

// 7878 は、よく使われる dev サーバーのポート (3000・5173・8080) と重ならないため。
const port = Number(process.env.AGENT_TIMELINE_PORT ?? 7878);

const app = createApp(logRootsFromEnv(process.env));
// ビルド済みの画面。`npm start` はリポジトリのルートで実行される。
app.use("/*", serveStatic({ root: "./dist/web" }));
// スレッドの URL は画面の中の場所で、ファイルではない。URL を直接開いた時も画面を返し、画面が URL から場所を読む。
app.get("/sessions/*", serveStatic({ path: "./dist/web/index.html" }));

// 127.0.0.1 だけで待ち受ける。ログインが無いため、別のマシンから会話に届かないようにする。
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(`agent-timeline: http://127.0.0.1:${info.port}`);
});
