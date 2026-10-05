import type { ServerType } from "@hono/node-server";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer } from "./server.js";
import { logRootsFromEnv } from "./timeline.js";
import { replyCommandsFromEnv } from "./tmux.js";

/** テストが起動したサーバー。テストごとに閉じる。 */
const runningServers: ServerType[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of runningServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/** 実際のホームディレクトリに書かないため、利用記録の置き場に使う一時ディレクトリを作る。 */
function makeTemporaryDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "agent-timeline-"));
}

/** サーバーを空いているポートで起動し、`/api/health` の応答の状態コードを返す。 */
async function startServerAndRequestHealth(usageLogDirectory: string): Promise<number> {
  // vitest.config.ts が、ログのルートの環境変数を fixtures/ の合成セッションに、tmux と ps を偽のコマンドに向けている。
  const server = await startServer({
    port: 0,
    logRoots: logRootsFromEnv(process.env),
    usageLogDirectory,
    replyCommands: replyCommandsFromEnv(process.env),
  });
  runningServers.push(server);
  const response = await fetch(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`,
  );
  return response.status;
}

/** 利用記録の各行を JSON として読む。 */
async function readUsageLogLines(usageLogDirectory: string): Promise<Record<string, unknown>[]> {
  return (await readFile(path.join(usageLogDirectory, "usage.jsonl"), "utf8"))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("startServer の利用記録", () => {
  it("起動で event が start の行が 1 行増え、行は event と at だけを持つ", async () => {
    const usageLogDirectory = await makeTemporaryDirectory();
    const previousLine = { event: "start", at: "2026-10-01T09:00:00+09:00" };
    await writeFile(
      path.join(usageLogDirectory, "usage.jsonl"),
      `${JSON.stringify(previousLine)}\n`,
    );
    // at は秒までのため、比較の下限を秒に切り下げる。
    const startedAfter = Math.floor(Date.now() / 1000) * 1000;

    expect(await startServerAndRequestHealth(usageLogDirectory)).toBe(200);

    const lines = await readUsageLogLines(usageLogDirectory);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual(previousLine);
    const startLine = lines[1];
    expect(Object.keys(startLine ?? {}).sort()).toEqual(["at", "event"]);
    expect(startLine?.event).toBe("start");
    expect(startLine?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    const startedAt = Date.parse(String(startLine?.at));
    expect(startedAt).toBeGreaterThanOrEqual(startedAfter);
    expect(startedAt).toBeLessThanOrEqual(Date.now());
  });

  it("記録先のディレクトリが無ければ作って書く", async () => {
    const usageLogDirectory = path.join(await makeTemporaryDirectory(), "agent-timeline");

    expect(await startServerAndRequestHealth(usageLogDirectory)).toBe(200);

    expect(await readUsageLogLines(usageLogDirectory)).toEqual([
      { event: "start", at: expect.any(String) },
    ]);
  });

  it("記録先に書けない時も起動する", async () => {
    // 記録先のディレクトリの親をファイルにして、ディレクトリを作れなくする (実行するユーザーの権限によらず失敗する)。
    const blockingFile = path.join(await makeTemporaryDirectory(), "not-a-directory");
    await writeFile(blockingFile, "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await startServerAndRequestHealth(path.join(blockingFile, "agent-timeline"))).toBe(200);

    expect(warn).toHaveBeenCalledOnce();
  });
});
