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

/** 画面全体に配る、ツール呼び出しを表示するかの設定。App が値を持ち、タイムラインとスレッドが読む。 */
export const ShowToolCallsContext = createContext(false);

/** ツール呼び出しを表示するかの設定を読む。 */
export function useShowToolCalls(): boolean {
  return useContext(ShowToolCallsContext);
}
