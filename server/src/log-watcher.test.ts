import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { createLogWatcher, type LogChangeListener } from "./log-watcher.js";
import type { LogRoots } from "./timeline.js";

// テストを待つ時間を短くするため、知らせをまとめる間隔を短くする。
const notifyIntervalMs = 20;

const claudeCart = "3f2a9c1e-5b7d-4e8a-9c6f-1a2b3c4d5e6f";
const codexNewSession = "0199c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";

/** fixtures/ を写した一時ディレクトリ。テストはここに追記し、fixtures/ は書き換えない。 */
let temporaryDirectory: string;
let logRoots: LogRoots;
/** テストの中で始めた購読をやめる関数。テストの後にやめ、見張りを止める。 */
let unsubscribers: (() => void)[];

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-timeline-log-watcher-"));
  await cp("fixtures/claude", path.join(temporaryDirectory, "claude"), { recursive: true });
  await cp("fixtures/codex", path.join(temporaryDirectory, "codex"), { recursive: true });
  logRoots = {
    claudeCodeProjectsDirectory: path.join(temporaryDirectory, "claude", "projects"),
    codexSessionsDirectory: path.join(temporaryDirectory, "codex", "sessions"),
  };
  unsubscribers = [];
});

afterEach(async () => {
  for (const unsubscribe of unsubscribers) {
    unsubscribe();
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
});

/** 見張りを作って listener の購読を始め、見張りが落ち着くまで待つ。 */
async function subscribe(listener: Mock<LogChangeListener>): Promise<void> {
  unsubscribers.push(createLogWatcher(logRoots, notifyIntervalMs).subscribe(listener));
  await settle(listener);
}

/**
 * 購読を始めた後、見張りが変化を届けられる状態になり、購読より前の変化が届き終わるまで待ってから、
 * listener の呼び出しの記録を消す。この後のテストの書き換えだけが listener に届く。
 *
 * macOS の fs.watch (FSEvents) は、watch() が返った後に別のスレッドで見張りを始める (libuv の src/unix/fsevents.c)。
 * 始まる前の書き換えは届かず (プロセスで最初の watch() は CoreFoundation の読み込みも伴い、特に遅い)、
 * 逆に見張りを始める直前の変化 (beforeEach での fixtures の写し) が見張りを始めた後に届くことがある。
 * そのため、claudeCart のログに追記して claudeCart が知らされるまで繰り返し、Claude Code のルートの見張りが動いている
 * ことを確かめ (FSEvents は変化を起きた順に届けるため、その時点で同じルートの写しの変化は届き終わっている)、
 * 進行中の知らせが無くなるまで待ってから記録を消す。Codex のルートは別の見張りで、ここでは動き出したことを確かめない。
 * Codex のルートに書くテストは、知らされるまで書き直す。
 */
async function settle(listener: Mock<LogChangeListener>): Promise<void> {
  await vi.waitFor(async () => {
    await appendFile(claudeCartLogPath(), "\n{}\n");
    expect(listener).toHaveBeenCalledWith([{ agent: "claude-code", sessionId: claudeCart }]);
  });
  await waitForNotifyIntervals();
  listener.mockClear();
}

/** 一時ディレクトリの claudeCart のログのファイル。 */
function claudeCartLogPath(): string {
  return path.join(
    logRoots.claudeCodeProjectsDirectory,
    "-home-dev-acme-shop",
    `${claudeCart}.jsonl`,
  );
}

/** codexNewSession のログのファイルを、一時ディレクトリの Codex のルートに書く。 */
async function writeCodexNewSessionLog(): Promise<void> {
  const dayDirectory = path.join(logRoots.codexSessionsDirectory, "2026", "10", "03");
  await mkdir(dayDirectory, { recursive: true });
  await writeFile(
    path.join(dayDirectory, `rollout-2026-10-03T09-00-00-${codexNewSession}.jsonl`),
    "{}\n",
  );
}

/** 見張りが変更の通知を何度かまとめ終えるまで待つ。 */
function waitForNotifyIntervals(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, notifyIntervalMs * 5));
}

describe("createLogWatcher", () => {
  it("ログが追記されたセッションを知らせる", async () => {
    const listener = vi.fn<LogChangeListener>();
    await subscribe(listener);

    await appendFile(claudeCartLogPath(), "\n{}\n");

    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith([{ agent: "claude-code", sessionId: claudeCart }]),
    );
  });

  it("新しく現れたセッションを知らせる", async () => {
    const listener = vi.fn<LogChangeListener>();
    await subscribe(listener);

    // Codex のルートの見張りが動き出す前の書き込みは届かないため、知らされるまで書き直す (settle のコメント)。
    await vi.waitFor(async () => {
      await writeCodexNewSessionLog();
      expect(listener).toHaveBeenCalledWith([{ agent: "codex", sessionId: codexNewSession }]);
    });
  });

  it("購読を始めた時に無かったルートが現れたら、そのセッションを知らせる", async () => {
    await rm(logRoots.codexSessionsDirectory, { recursive: true });
    const listener = vi.fn<LogChangeListener>();
    await subscribe(listener);

    await writeCodexNewSessionLog();

    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith([{ agent: "codex", sessionId: codexNewSession }]),
    );
  });

  it("見張っているルートが消えて作り直されたら、そのセッションを知らせる", async () => {
    const listener = vi.fn<LogChangeListener>();
    await subscribe(listener);

    await rm(logRoots.codexSessionsDirectory, { recursive: true });
    await waitForNotifyIntervals();
    await writeCodexNewSessionLog();

    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith([{ agent: "codex", sessionId: codexNewSession }]),
    );
  });

  it("ログが変わらない間は知らせない", async () => {
    const listener = vi.fn<LogChangeListener>();
    await subscribe(listener);

    await waitForNotifyIntervals();

    expect(listener).not.toHaveBeenCalled();
  });

  it("subagent のログの変化は知らせない", async () => {
    const subagentsDirectory = path.join(
      logRoots.claudeCodeProjectsDirectory,
      "-home-dev-acme-shop",
      claudeCart,
      "subagents",
    );
    await mkdir(subagentsDirectory, { recursive: true });
    const listener = vi.fn<LogChangeListener>();
    await subscribe(listener);

    await writeFile(path.join(subagentsDirectory, "agent-1.jsonl"), "{}\n");
    await waitForNotifyIntervals();

    expect(listener).not.toHaveBeenCalled();
  });

  it("購読をやめた listener には知らせない", async () => {
    const watcher = createLogWatcher(logRoots, notifyIntervalMs);
    const stoppedListener = vi.fn<LogChangeListener>();
    const activeListener = vi.fn<LogChangeListener>();
    const unsubscribe = watcher.subscribe(stoppedListener);
    unsubscribers.push(watcher.subscribe(activeListener));
    unsubscribe();
    await settle(activeListener);

    await appendFile(claudeCartLogPath(), "\n{}\n");

    await vi.waitFor(() => expect(activeListener).toHaveBeenCalled());
    expect(stoppedListener).not.toHaveBeenCalled();
  });

  it("購読者が全ていなくなった後に購読を始め直すと、また知らせる", async () => {
    const watcher = createLogWatcher(logRoots, notifyIntervalMs);
    watcher.subscribe(vi.fn<LogChangeListener>())();
    const listener = vi.fn<LogChangeListener>();
    unsubscribers.push(watcher.subscribe(listener));
    await settle(listener);

    await appendFile(claudeCartLogPath(), "\n{}\n");

    await vi.waitFor(() =>
      expect(listener).toHaveBeenCalledWith([{ agent: "claude-code", sessionId: claudeCart }]),
    );
  });
});
