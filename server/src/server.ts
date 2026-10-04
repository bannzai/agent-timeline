import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import type { LogRoots } from "./timeline.js";
import { appendStartEvent } from "./usage-log.js";

/** startServer に渡す設定。 */
export interface StartServerOptions {
  /** 待ち受けるポート。0 なら空いているポートを OS が選ぶ。 */
  port: number;
  /** 読むセッションのログのルート。 */
  logRoots: LogRoots;
  /** 利用記録 (usage.jsonl) を置くディレクトリ。 */
  usageLogDirectory: string;
}

/**
 * サーバーを起動し、待ち受けを始めて利用記録を書き終えた時にサーバーを返す。
 * 利用記録を書けない時は警告だけ出して起動を続ける。待ち受けに失敗した時は reject する。
 */
export function startServer(options: StartServerOptions): Promise<ServerType> {
  const app = createApp(options.logRoots);
  // ビルド済みの画面。`npm start` はリポジトリのルートで実行される。
  app.use("/*", serveStatic({ root: "./dist/web" }));

  return new Promise((resolve, reject) => {
    // 127.0.0.1 だけで待ち受ける。ログインが無いため、別のマシンから会話に届かないようにする。
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: options.port }, () => {
      // 待ち受けに失敗した起動を数えないため、待ち受けを始めてから書く。
      // 利用記録は判定のための計測で、書けなくてもアプリは使えるため、警告だけ出して起動を続ける。
      appendStartEvent(options.usageLogDirectory, new Date())
        .catch((error: unknown) => {
          console.warn(`agent-timeline: 利用記録を書けなかった (${String(error)})`);
        })
        .finally(() => resolve(server));
    });
    server.once("error", reject);
  });
}
