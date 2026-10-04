import { useEffect, useRef } from "react";
import type { SessionsChangedEvent } from "../../server/src/post.js";

// EventSource が自分でつなぎ直すのをやめた時 (サーバーが 200 以外を返した時など) に、もう一度つなぐまでの時間。
// サーバーが止まっている間に繰り返しつなぎに行かないよう、ブラウザの既定のつなぎ直しの間隔 (Chrome で 3 秒) に合わせる。
const reconnectDelayMs = 3000;

/**
 * ログの変化を受け取る関数。changedSessions は、ログが追記されたか新しく現れたセッション。
 * null は、つながっていない間の変化が分からないことを表し、受け取った側は読み直す。
 */
type LogChangeListener = (changedSessions: SessionsChangedEvent["sessions"] | null) => void;

/** 画面の中の購読者。タブごとに 1 本の接続を共有し、ブラウザが同じオリジンへ同時に張れる接続の数を使い切らないようにする。 */
const listeners = new Set<LogChangeListener>();
/** 共有の接続。購読者がいない間は null。 */
let sharedEventSource: EventSource | null = null;
/** 共有の接続が ready を受けた後で、まだ切れていないか。 */
let sharedEventSourceReady = false;
/** 共有の接続をつなぎ直すまで待っているタイマー。 */
let reconnectTimer: number | undefined;

/** 全ての購読者に変化を知らせる。 */
function notifyListeners(changedSessions: SessionsChangedEvent["sessions"] | null): void {
  for (const listener of listeners) {
    listener(changedSessions);
  }
}

/** 知らせの API (`/api/events`) につなぎ、共有の接続にする。 */
function connect(): void {
  const eventSource = new EventSource("/api/events");
  sharedEventSource = eventSource;
  eventSource.addEventListener("ready", () => {
    sharedEventSourceReady = true;
    notifyListeners(null);
  });
  eventSource.addEventListener("sessions-changed", (event: MessageEvent<string>) => {
    notifyListeners((JSON.parse(event.data) as SessionsChangedEvent).sessions);
  });
  eventSource.addEventListener("error", () => {
    sharedEventSourceReady = false;
    // 切れた時は、ふつう EventSource が自分でつなぎ直す。つなぎ直しをやめて閉じた時だけ作り直す。
    if (eventSource.readyState === EventSource.CLOSED) {
      reconnectTimer = window.setTimeout(connect, reconnectDelayMs);
    }
  });
}

/**
 * listener の購読を始め、購読をやめる関数を返す。最初の購読者がつなぎ、最後の購読者がやめると切る。
 * つながった後に加わった購読者には、加わる前の変化が分からないため null を 1 度渡す。
 */
function subscribeLogChanges(listener: LogChangeListener): () => void {
  listeners.add(listener);
  if (sharedEventSource === null) {
    connect();
  } else if (sharedEventSourceReady) {
    queueMicrotask(() => {
      if (listeners.has(listener)) {
        listener(null);
      }
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearTimeout(reconnectTimer);
      sharedEventSource?.close();
      sharedEventSource = null;
      sharedEventSourceReady = false;
    }
  };
}

/**
 * ログの変化の知らせを受け取り、onChange を呼ぶ。changedSessions は、ログが追記されたか新しく現れたセッション。
 * つながった時とつなぎ直した時は、つながっていない間の変化が分からないため null を渡す。受け取った側はその時に読み直す。
 * enabled が false の間は受け取らない。
 */
export function useLogChanges(onChange: LogChangeListener, enabled: boolean): void {
  // 購読したままコールバックだけを差し替えるため、最新のコールバックを持っておく。
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return subscribeLogChanges((changedSessions) => onChangeRef.current(changedSessions));
  }, [enabled]);
}
