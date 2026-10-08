import { createContext, useContext } from "react";

/**
 * ツール呼び出しを表示するかをブラウザに保存するキー。設定はこのブラウザだけのもので、次に開いた時も保たれる。
 * E2E も、設定を入れた状態で開くためにこのキーを使う。
 */
export const showToolCallsStorageKey = "agent-timeline.show-tool-calls";

/** ツール呼び出しを出さない時に一覧の API (`/api/posts`) の `authors` へ渡す、会話の投稿の書き手。 */
export const conversationAuthors = "human,agent";

/**
 * ブラウザに保存したツール呼び出しの表示の設定を読む。保存が無い時と読めない時 (localStorage が使えない時) は、
 * タイムラインが会話だけになるよう false を返す。
 */
export function readShowToolCalls(): boolean {
  try {
    return window.localStorage.getItem(showToolCallsStorageKey) === "true";
  } catch {
    return false;
  }
}

/** ツール呼び出しの表示の設定をブラウザに保存する。保存できない時 (localStorage が使えない時) は何もしない。 */
export function writeShowToolCalls(showToolCalls: boolean): void {
  try {
    window.localStorage.setItem(showToolCallsStorageKey, String(showToolCalls));
  } catch {
    // 保存できなくても、開いている間の表示は state で続ける。
  }
}

/** 画面全体に配る、ツール呼び出しを表示するかの設定と、それを替える関数。 */
export interface ShowToolCallsSetting {
  /** ツール呼び出しを表示するか。 */
  showToolCalls: boolean;
  /** 設定を替え、ブラウザに保存する。 */
  setShowToolCalls: (showToolCalls: boolean) => void;
}

/**
 * 画面全体に配る設定。App が値を持ち、スイッチが替え、タイムラインとスレッドが読む。
 * Provider の外で読んだ時の値は、既定の表示 (ツール呼び出しを出さない) と同じにし、替える関数は何もしない。
 */
export const ShowToolCallsContext = createContext<ShowToolCallsSetting>({
  showToolCalls: false,
  setShowToolCalls: () => {},
});

/** ツール呼び出しを表示するかの設定と、それを替える関数を読む。 */
export function useShowToolCallsSetting(): ShowToolCallsSetting {
  return useContext(ShowToolCallsContext);
}

/** ツール呼び出しを表示するかの設定を読む。 */
export function useShowToolCalls(): boolean {
  return useShowToolCallsSetting().showToolCalls;
}
