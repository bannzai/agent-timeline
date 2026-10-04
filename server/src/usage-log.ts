import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * 環境変数から利用記録 (usage.jsonl) を置くディレクトリを決める。テストと CI は、ここで一時ディレクトリに差し替える。
 * 既定は documents/DIRECTION.md の判定基準が数える場所。
 */
export function usageLogDirectoryFromEnv(env: NodeJS.ProcessEnv): string {
  return env.AGENT_TIMELINE_USAGE_DIR ?? path.join(os.homedir(), ".agent-timeline");
}

/** 2 桁に満たない数を 0 で埋める。 */
function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 日時を、このマシンの時差付きの ISO 8601 (例: 2026-10-04T21:05:09+09:00) にする。
 * 判定基準の集計は先頭 10 文字を日付として数えるため、UTC ではなく利用者の暦の日付を先頭に置く。
 */
export function localIsoTimestamp(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}` +
    `T${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}` +
    `${offsetMinutes < 0 ? "-" : "+"}${twoDigits(Math.floor(absoluteOffsetMinutes / 60))}:${twoDigits(absoluteOffsetMinutes % 60)}`
  );
}

/** 利用記録に書く出来事。start はサーバーの起動、reply は返信の送信。 */
export type UsageEvent = "start" | "reply";

/**
 * 利用記録に出来事の行 (`{"event":"start","at":...}`) を 1 行足す。ディレクトリが無ければ作る。書けない時は reject する。
 * 起動・返信の 1 回ごとに 1 行増えることが記録の意味のため、冪等にしない。
 */
export async function appendUsageEvent(
  directory: string,
  event: UsageEvent,
  date: Date,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await appendFile(
    path.join(directory, "usage.jsonl"),
    `${JSON.stringify({ event, at: localIsoTimestamp(date) })}\n`,
  );
}
