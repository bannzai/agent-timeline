import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";

// 7878 is outside the ports that common dev servers take (3000, 5173, 8080), so it rarely collides.
const port = Number(process.env.AGENT_TIMELINE_PORT ?? 7878);

const app = createApp();
// The built web app; `npm start` runs from the repository root.
app.use("/*", serveStatic({ root: "./dist/web" }));

// 127.0.0.1 only: there is no login, so the conversations must not be reachable from another machine.
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(`agent-timeline: http://127.0.0.1:${info.port}`);
});
