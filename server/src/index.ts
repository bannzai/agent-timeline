import type { AddressInfo } from "node:net";
import { startServer } from "./server.js";
import { logRootsFromEnv } from "./timeline.js";
import { usageLogDirectoryFromEnv } from "./usage-log.js";

const server = await startServer({
  // 7878 は、よく使われる dev サーバーのポート (3000・5173・8080) と重ならないため。
  port: Number(process.env.AGENT_TIMELINE_PORT ?? 7878),
  logRoots: logRootsFromEnv(process.env),
  usageLogDirectory: usageLogDirectoryFromEnv(process.env),
});
console.log(`agent-timeline: http://127.0.0.1:${(server.address() as AddressInfo).port}`);
