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
      // サーバー (server/src/index.ts) と同じ環境変数・同じ既定値にし、ポートを変えても `npm run dev` が追随するようにする。
      "/api": `http://127.0.0.1:${process.env.AGENT_TIMELINE_PORT ?? 7878}`,
    },
  },
});
