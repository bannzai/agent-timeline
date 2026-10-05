import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { type AppOptions, createApp } from "./app.js";
import { appendUsageEvent } from "./usage-log.js";

/** startServer に渡す設定。 */
export interface StartServerOptions extends AppOptions {
  /** 待ち受けるポート。0 なら空いているポートを OS が選ぶ。 */
  port: number;
}

/**
 * サーバーを起動し、待ち受けを始めて利用記録を書き終えた時にサーバーを返す。
 * 利用記録を書けない時は警告だけ出して起動を続ける。待ち受けに失敗した時は reject する。
 */
export function startServer(options: StartServerOptions): Promise<ServerType> {
  const app = createApp(options);
  // ビルド済みの画面。`npm start` はリポジトリのルートで実行される。
  app.use("/*", serveStatic({ root: "./dist/web" }));
  // スレッドとプロジェクトの URL は画面の中の場所で、ファイルではない。URL を直接開いた時も画面を返し、画面が URL から場所を読む。
  app.get("/sessions/*", serveStatic({ path: "./dist/web/index.html" }));
  app.get("/projects/*", serveStatic({ path: "./dist/web/index.html" }));

  return new Promise((resolve, reject) => {
    // 127.0.0.1 だけで待ち受ける。ログインが無いため、別のマシンから会話に届かないようにする。
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: options.port }, () => {
      // 待ち受けの後に起きたエラーを握りつぶさず、これまでどおりプロセスを止めるため。
      server.off("error", reject);
      // 待ち受けに失敗した起動を数えないため、待ち受けを始めてから書く。
      // 利用記録は判定のための計測で、書けなくてもアプリは使えるため、警告だけ出して起動を続ける。
      appendUsageEvent(options.usageLogDirectory, "start", new Date())
        .catch((error: unknown) => {
          console.warn(`agent-timeline: 利用記録を書けなかった (${String(error)})`);
        })
        .finally(() => resolve(server));
    });
    server.once("error", reject);
  });
}
