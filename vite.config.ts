import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        // サーバー (server/src/index.ts) と同じ環境変数・同じ既定値にし、ポートを変えても `npm run dev` が追随するようにする。
        target: `http://127.0.0.1:${process.env.AGENT_TIMELINE_PORT ?? 7878}`,
        // 返信の API は Origin が Host と同じオリジンの時だけ受け付ける。vite は文字列だけの指定では Host を転送先に書き換える
        // (changeOrigin: true) ため、画面のオリジン (vite のポート) の Host のまま転送する。
        changeOrigin: false,
      },
    },
  },
});
