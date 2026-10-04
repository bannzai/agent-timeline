import { Hono } from "hono";

/** The HTTP API of agent-timeline, without the static files and without a listening socket, so tests can call it directly. */
export function createApp(): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  return app;
}
