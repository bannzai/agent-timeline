import { stat } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { SessionsChangedEvent } from "./post.js";
import { type LogRoots, listSessionLogFiles } from "./timeline.js";

/** ログの変化を受け取る関数。changedSessions は、ログが追記されたか新しく現れたセッション。 */
export type LogChangeListener = (changedSessions: SessionsChangedEvent["sessions"]) => void;

/** ログのルートの配下の、セッションのログのファイルの追記と新しいファイルを見張る。 */
export interface LogWatcher {
  /**
   * listener の購読を始める。購読の時点のログを基準にした後で resolve し、それより後の変化を listener に知らせる。
   * resolve した値は、購読をやめる関数。
   */
  subscribe(listener: LogChangeListener): Promise<() => void>;
}

/** 1 つのログのファイルを見た結果。signature は、追記と書き換えで変わる値 (大きさと最終更新の日時) をつないだもの。 */
interface LogFileSignature {
  session: SessionsChangedEvent["sessions"][number];
  signature: string;
}

/**
 * ログのルートを pollIntervalMs ごとに見て、ファイルの大きさか最終更新の日時が変わったセッションを知らせる見張りを作る。
 * 購読者がいる間だけ見張り、いなくなったら止まる。
 *
 * fs.watch ではなく定期的に見るのは、ログのルートが無いマシン (Claude Code か Codex の片方しか使わない) があり、
 * fs.watch の recursive が OS ごとに仕組みが違う (Linux では Node が inotify でディレクトリごとに組み立てる) ため。
 */
export function createLogWatcher(logRoots: LogRoots, pollIntervalMs: number): LogWatcher {
  const listeners = new Set<LogChangeListener>();
  // 見張りが動いている間、その最初の基準ができた時に resolve する。動いていなければ null。
  let baselineReady: Promise<void> | null = null;

  /** ログのファイルのパスごとに、そのファイルを見た結果を返す。 */
  async function readLogFileSignatures(): Promise<Map<string, LogFileSignature>> {
    const signatures = new Map<string, LogFileSignature>();
    for (const sessionLogFile of await listSessionLogFiles(logRoots)) {
      // 一覧を取った後に消えたファイルは見張らない。
      const fileStats = await stat(sessionLogFile.path).catch(() => null);
      if (fileStats !== null) {
        signatures.set(sessionLogFile.path, {
          session: { agent: sessionLogFile.agent, sessionId: sessionLogFile.sessionId },
          signature: `${fileStats.size}:${fileStats.mtimeMs}`,
        });
      }
    }
    return signatures;
  }

  /** 購読者がいる間、ログを見て変化を知らせ続ける。onBaseline は最初の基準ができた時に呼ぶ。 */
  async function watchWhileSubscribed(onBaseline: () => void): Promise<void> {
    let previousSignatures = await readLogFileSignatures();
    onBaseline();
    while (listeners.size > 0) {
      await sleep(pollIntervalMs);
      const currentSignatures = await readLogFileSignatures();
      const changedSessions = [...currentSignatures]
        .filter(
          ([logPath, { signature }]) => previousSignatures.get(logPath)?.signature !== signature,
        )
        .map(([, { session }]) => session);
      previousSignatures = currentSignatures;
      if (changedSessions.length > 0) {
        for (const listener of listeners) {
          listener(changedSessions);
        }
      }
    }
    baselineReady = null;
  }

  return {
    async subscribe(listener) {
      listeners.add(listener);
      baselineReady ??= new Promise<void>((resolve) => {
        void watchWhileSubscribed(resolve);
      });
      await baselineReady;
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
