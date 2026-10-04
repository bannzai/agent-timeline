import { useEffect, useRef } from "react";
import type { SessionsChangedEvent } from "../../server/src/post.js";

// EventSource が自分でつなぎ直すのをやめた時 (サーバーが 200 以外を返した時など) に、もう一度つなぐまでの時間。
// サーバーが止まっている間に繰り返しつなぎに行かないよう、ブラウザの既定のつなぎ直しの間隔 (Chrome で 3 秒) に合わせる。
const reconnectDelayMs = 3000;

/**
 * ログの変化の知らせ (`/api/events`) を受け取り、onChange を呼ぶ。changedSessions は、ログが追記されたか新しく現れたセッション。
 * つながった時とつなぎ直した時は、つながっていない間の変化が分からないため null を渡す。受け取った側はその時に読み直す。
 * enabled が false の間はつながない。
 */
export function useLogChanges(
  onChange: (changedSessions: SessionsChangedEvent["sessions"] | null) => void,
  enabled: boolean,
): void {
  // つないだままコールバックだけを差し替えるため、最新のコールバックを持っておく。
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | undefined;
    /** 知らせの API につなぐ。 */
    const connect = () => {
      const currentEventSource = new EventSource("/api/events");
      eventSource = currentEventSource;
      currentEventSource.addEventListener("ready", () => onChangeRef.current(null));
      currentEventSource.addEventListener("sessions-changed", (event: MessageEvent<string>) => {
        onChangeRef.current((JSON.parse(event.data) as SessionsChangedEvent).sessions);
      });
      currentEventSource.addEventListener("error", () => {
        // 切れた時は、ふつう EventSource が自分でつなぎ直す。つなぎ直しをやめて閉じた時だけ作り直す。
        if (currentEventSource.readyState === EventSource.CLOSED) {
          reconnectTimer = window.setTimeout(connect, reconnectDelayMs);
        }
      });
    };
    connect();
    return () => {
      window.clearTimeout(reconnectTimer);
      eventSource?.close();
    };
  }, [enabled]);
}
