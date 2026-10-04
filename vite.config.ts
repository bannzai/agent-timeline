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
      // The same variable and default as the server (server/src/index.ts), so `npm run dev` follows a changed port.
      "/api": `http://127.0.0.1:${process.env.AGENT_TIMELINE_PORT ?? 7878}`,
    },
  },
});
