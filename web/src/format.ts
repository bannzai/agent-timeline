import type { PostSession } from "../../server/src/post.js";
import { checkoutOfDirectory } from "../../server/src/project.js";

// 省略する本文の文字数の上限。X が 1 つのポストに書ける文字数 (280) に合わせ、タイムラインの 1 投稿の長さを X と同じくらいにする。
const collapsedTextMaxLength = 280;
// 省略する本文の行数の上限。箇条書きの多い返答でも、1 投稿がノート PC の画面の半分を超えない行数として選んだ。
const collapsedTextMaxLines = 8;

const secondMilliseconds = 1000;
const minuteMilliseconds = 60 * secondMilliseconds;
const hourMilliseconds = 60 * minuteMilliseconds;
const dayMilliseconds = 24 * hourMilliseconds;

/** 投稿者の名前に使う、セッションのプロジェクトの名前。worktree で動いたセッションも、worktree ではなくプロジェクトの名前を返す。 */
export function projectName(session: PostSession): string {
  return checkoutOfDirectory(session.projectDirectory)?.projectName ?? "プロジェクト不明";
}

/**
 * プロジェクトのアイコンに出す頭文字。`-`・`_`・`.`・空白で区切った名前は最初の 2 語の頭文字 (`acme-shop` は `AS`)、
 * 区切りの無い名前は先頭の 2 文字 (`castle` は `CA`) を大文字で返す。
 */
export function projectInitials(name: string): string {
  const words = name.split(/[-_.\s]+/).filter((word) => word !== "");
  const initials =
    words.length >= 2
      ? words.slice(0, 2).map((word) => Array.from(word)[0])
      : Array.from(name).slice(0, 2);
  return initials.join("").toUpperCase();
}

/** プロジェクトのアイコンの色相 (0〜359)。同じ名前には毎回同じ色を返し、並んだプロジェクトを色でも見分けられるようにする。 */
export function projectHue(name: string): number {
  // 31 は文字列の hash (Java の String.hashCode など) で広く使われる係数。
  return Array.from(name).reduce(
    (hue, character) => (hue * 31 + (character.codePointAt(0) ?? 0)) % 360,
    0,
  );
}

/** agent の種類の表示名。 */
export function agentLabel(session: PostSession): string {
  return session.agent === "claude-code" ? "Claude Code" : "Codex";
}

/**
 * 投稿の日時を、X のタイムラインと同じ形の相対時刻にする。24 時間以内は経過時間 (`5分`)、
 * それより前は日付 (`10月1日`、年が違えば `2025年10月1日`) を返す。now は表示する時点。
 */
export function relativeTimeText(timestamp: string, now: Date): string {
  const date = new Date(timestamp);
  // 端末の時計がログを書いたマシンより遅れていると、経過時間が負になる。その時は 0 秒として出す。
  const elapsed = Math.max(0, now.getTime() - date.getTime());
  if (elapsed < minuteMilliseconds) {
    return `${Math.floor(elapsed / secondMilliseconds)}秒`;
  }
  if (elapsed < hourMilliseconds) {
    return `${Math.floor(elapsed / minuteMilliseconds)}分`;
  }
  if (elapsed < dayMilliseconds) {
    return `${Math.floor(elapsed / hourMilliseconds)}時間`;
  }
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === now.getFullYear() ? monthDay : `${date.getFullYear()}年${monthDay}`;
}

/** 投稿の日時を、相対時刻に添える日付と時刻の文 (`2026年10月1日 18:10`) にする。 */
export function absoluteTimeText(timestamp: string): string {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeStyle: "short" }).format(
    new Date(timestamp),
  );
}

/** 本文をタイムラインで省略して出す時の先頭。省略しなくてよい長さなら null を返す。 */
export function collapsedText(text: string): string | null {
  const lines = text.split("\n");
  // 文字数は UTF-16 のコード単位ではなく文字 (コードポイント) で数え、絵文字を途中で切らないようにする。
  if (Array.from(text).length <= collapsedTextMaxLength && lines.length <= collapsedTextMaxLines) {
    return null;
  }
  // 末尾の空行と空白を落とし、続きがあることを示す「…」を最後の文の直後に置けるようにする。
  return Array.from(lines.slice(0, collapsedTextMaxLines).join("\n"))
    .slice(0, collapsedTextMaxLength)
    .join("")
    .trimEnd();
}
