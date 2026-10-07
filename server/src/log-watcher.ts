import { existsSync, type FSWatcher, watch } from "node:fs";
import { stat } from "node:fs/promises";
import { claudeCodeSessionLogFileAt, listClaudeCodeSessionLogFiles } from "./claude-code-log.js";
import { codexSessionLogFileAt, listCodexSessionLogFiles } from "./codex-log.js";
import type { SessionLogFile, SessionsChangedEvent } from "./post.js";
import type { LogRoots } from "./timeline.js";

/** ログの変化を受け取る関数。changedSessions は、ログが追記されたか新しく現れたセッション。 */
export type LogChangeListener = (changedSessions: SessionsChangedEvent["sessions"]) => void;

/** ログのルートの配下の、セッションのログのファイルの追記と新しいファイルを見張る。 */
export interface LogWatcher {
  /**
   * listener の購読を始める。見張りを始めた後で返り、それより後の変化を listener に知らせる。返す値は、購読をやめる関数。
   * ただし macOS の fs.watch (FSEvents) は返った後に別のスレッドで見張りを始めるため、返った直後の変化は届かないことがあり、
   * 逆に見張りを始める直前の変化が知らされることもある。購読する側は、知らせを「このセッションを読み直す合図」として
   * 受け、変化の有無や回数の正確さには頼らない。
   */
  subscribe(listener: LogChangeListener): () => void;
}

/** 見張る 1 つのログのルートと、その配下のパスをセッションのログのファイルとして読む方法。 */
interface WatchedLogRoot {
  /** ルートのディレクトリ。 */
  directory: string;
  /** ルートからの相対パスがセッションのログのファイルの形なら、そのファイルを返す。 */
  sessionLogFileAt: (directory: string, relativePath: string) => SessionLogFile | null;
  /** ルートの配下のセッションのログのファイルを返す。 */
  listSessionLogFiles: (directory: string) => Promise<SessionLogFile[]>;
}

/**
 * ログのルートの変更の通知 (fs.watch) を受け、ファイルの大きさか最終更新の日時が変わったセッションを、notifyIntervalMs ごとにまとめて知らせる見張りを作る。
 * 購読者がいる間だけ見張り、いなくなったら止まる。まだ無いルート (Claude Code か Codex の片方しか使わないマシン) は、
 * notifyIntervalMs ごとに見張りを始め直し、現れた時点のファイルを新しいセッションとして知らせる。
 *
 * 全てのファイルを定期的に見ないのは、数万のセッションのログ (2026-10-06 に開発者のマシンで約 4.9 万ファイル) を
 * 1 秒ごとに stat すると、ログが変わらない間も CPU を 1 コア以上使い続けたため (https://github.com/bannzai/agent-timeline/issues/25 )。
 * Linux では Node がファイルとディレクトリごとに inotify の見張りを置くため、ログのファイルの数だけ見張りが要る
 * (上限は fs.inotify.max_user_watches。2026-10-06 の GitHub Actions の ubuntu-latest は 655360 で、約 5 万ファイルを見張れた)。
 */
export function createLogWatcher(logRoots: LogRoots, notifyIntervalMs: number): LogWatcher {
  const listeners = new Set<LogChangeListener>();
  const watchedLogRoots: WatchedLogRoot[] = [
    {
      directory: logRoots.claudeCodeProjectsDirectory,
      sessionLogFileAt: claudeCodeSessionLogFileAt,
      listSessionLogFiles: listClaudeCodeSessionLogFiles,
    },
    {
      directory: logRoots.codexSessionsDirectory,
      sessionLogFileAt: codexSessionLogFileAt,
      listSessionLogFiles: listCodexSessionLogFiles,
    },
  ];
  /** 見張りを始められたルートごとの見張り。 */
  const rootWatchers = new Map<WatchedLogRoot, FSWatcher>();
  /** 変更の通知を受け、次に知らせる時に見るログのファイル。パスごとに 1 つ。 */
  const pendingLogFiles = new Map<string, SessionLogFile>();
  /** 最後に知らせた時のファイルの大きさと最終更新の日時をつないだもの。パスごと。 */
  const notifiedSignatures = new Map<string, string>();
  /** pendingLogFiles を見て知らせるまで待っているタイマー。 */
  let notifyTimer: NodeJS.Timeout | undefined;
  /** まだ見張れていないルートの見張りを始め直すまで待っているタイマー。 */
  let retryTimer: NodeJS.Timeout | undefined;
  /** 見張りを止めるたびに増える番号。止める前に始まった知らせが、止めた後の状態を書き換えないように比べる。 */
  let watchGeneration = 0;

  /** sessionLogFile を、次に知らせる時に見るファイルに加える。 */
  function addPendingLogFile(sessionLogFile: SessionLogFile): void {
    pendingLogFiles.set(sessionLogFile.path, sessionLogFile);
    notifyTimer ??= setTimeout(() => void notifyChangedSessions(), notifyIntervalMs);
  }

  /** pendingLogFiles のうち、大きさか最終更新の日時が変わったファイルのセッションを知らせる。 */
  async function notifyChangedSessions(): Promise<void> {
    notifyTimer = undefined;
    const notifyGeneration = watchGeneration;
    const sessionLogFiles = [...pendingLogFiles.values()];
    pendingLogFiles.clear();
    const changedSessions: SessionsChangedEvent["sessions"] = [];
    for (const sessionLogFile of sessionLogFiles) {
      const fileStats = await stat(sessionLogFile.path).catch(() => null);
      // stat を待つ間に見張りが止められたら、残りを見ずにやめる。
      if (notifyGeneration !== watchGeneration) {
        return;
      }
      // 消えたファイルとディレクトリは知らせない。
      if (fileStats === null || !fileStats.isFile()) {
        notifiedSignatures.delete(sessionLogFile.path);
        continue;
      }
      const signature = `${fileStats.size}:${fileStats.mtimeMs}`;
      if (notifiedSignatures.get(sessionLogFile.path) !== signature) {
        notifiedSignatures.set(sessionLogFile.path, signature);
        changedSessions.push({ agent: sessionLogFile.agent, sessionId: sessionLogFile.sessionId });
      }
    }
    if (changedSessions.length > 0) {
      for (const listener of listeners) {
        listener(changedSessions);
      }
    }
  }

  /**
   * まだ見張っていないルートの見張りを始める。始められなかったルートがあれば、notifyIntervalMs の後にやり直す。
   * isRetry は、購読を始めた時ではなくやり直しで呼ぶ時に true にする。やり直しで見張りを始めたルートのファイルは、
   * 購読を始めた後に現れたものなので、新しいセッションとして知らせる。
   */
  function watchLogRoots(isRetry: boolean): void {
    for (const watchedLogRoot of watchedLogRoots) {
      if (rootWatchers.has(watchedLogRoot)) {
        continue;
      }
      try {
        const rootWatcher = watch(
          watchedLogRoot.directory,
          { recursive: true },
          (eventType, relativePath) => {
            // Linux の Node は、ルート自身が消えると相対パスが空の rename を送り、それより後はルートを見張らない。
            // ルートが消えても error が届くとは限らないため、rename の時はルートが残っているかも見る。
            if (
              relativePath === "" ||
              (eventType === "rename" && !existsSync(watchedLogRoot.directory))
            ) {
              unwatchLogRoot(watchedLogRoot, rootWatcher);
              return;
            }
            const sessionLogFile =
              relativePath === null
                ? null
                : watchedLogRoot.sessionLogFileAt(watchedLogRoot.directory, relativePath);
            if (sessionLogFile !== null) {
              addPendingLogFile(sessionLogFile);
            }
          },
        );
        rootWatcher.on("error", () => unwatchLogRoot(watchedLogRoot, rootWatcher));
        rootWatchers.set(watchedLogRoot, rootWatcher);
        if (isRetry) {
          void addExistingLogFiles(watchedLogRoot, rootWatcher);
        }
      } catch {
        scheduleRetry();
      }
    }
  }

  /**
   * ルートが消えた時などに、watchedLogRoot の見張り rootWatcher を閉じ、ルートが無い時と同じように見張りを始め直す。
   * rootWatcher が既に閉じられていれば何もしない。
   */
  function unwatchLogRoot(watchedLogRoot: WatchedLogRoot, rootWatcher: FSWatcher): void {
    if (rootWatchers.get(watchedLogRoot) !== rootWatcher) {
      return;
    }
    rootWatcher.close();
    rootWatchers.delete(watchedLogRoot);
    scheduleRetry();
  }

  /** watchedLogRoot の今あるログのファイルを、次に知らせる時に見るファイルに加える。読む間に rootWatcher が閉じられたら加えない。 */
  async function addExistingLogFiles(
    watchedLogRoot: WatchedLogRoot,
    rootWatcher: FSWatcher,
  ): Promise<void> {
    const sessionLogFiles = await watchedLogRoot.listSessionLogFiles(watchedLogRoot.directory);
    if (rootWatchers.get(watchedLogRoot) === rootWatcher) {
      sessionLogFiles.forEach(addPendingLogFile);
    }
  }

  /** notifyIntervalMs の後に、まだ見張れていないルートの見張りを始め直す。既に待っていれば何もしない。 */
  function scheduleRetry(): void {
    retryTimer ??= setTimeout(() => {
      retryTimer = undefined;
      watchLogRoots(true);
    }, notifyIntervalMs);
  }

  /** 全てのルートの見張りと待っているタイマーを止め、覚えていたファイルを忘れる。 */
  function stopWatching(): void {
    watchGeneration++;
    for (const rootWatcher of rootWatchers.values()) {
      rootWatcher.close();
    }
    rootWatchers.clear();
    clearTimeout(notifyTimer);
    notifyTimer = undefined;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    pendingLogFiles.clear();
    notifiedSignatures.clear();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        watchLogRoots(false);
      }
      return () => {
        if (listeners.delete(listener) && listeners.size === 0) {
          stopWatching();
        }
      };
    },
  };
}
