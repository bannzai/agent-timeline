import { open } from "node:fs/promises";
import { parseJson } from "./post.js";

// 1 回に読む量。Codex の先頭の行 (session_meta) は agent への指示の全文を持ち数十 KB になるため、
// 多くのファイルで 1〜2 回の読み取りに収まり、大きなログでも先頭の近くしか読まない大きさにした。
const readChunkBytes = 64 * 1024;

/**
 * ログのファイルを先頭から 1 行ずつ JSON として読み、pick が null でない値を返した最初の値を返す。そこで読むのをやめるため、
 * 先頭の近くの行で分かる値を、大きなログの全体を読まずに取れる。どの行も値を返さない時と、ファイルを読めない時は null を返す。
 */
export async function findInLogLines<T>(
  logPath: string,
  pick: (entry: unknown) => T | null,
): Promise<T | null> {
  const fileHandle = await open(logPath).catch(() => null);
  if (fileHandle === null) {
    return null;
  }
  try {
    const buffer = Buffer.alloc(readChunkBytes);
    const decoder = new TextDecoder();
    // 読んだうち、まだ改行が来ていない最後の行。
    let pendingText = "";
    for (;;) {
      const { bytesRead } = await fileHandle.read(buffer, 0, readChunkBytes, null);
      const lines = (
        pendingText + decoder.decode(buffer.subarray(0, bytesRead), { stream: bytesRead > 0 })
      ).split("\n");
      // ファイルの終わりでは、改行で終わらない最後の行も 1 行として読む。
      pendingText = bytesRead === 0 ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        const value = pick(parseJson(line));
        if (value !== null) {
          return value;
        }
      }
      if (bytesRead === 0) {
        return null;
      }
    }
  } catch {
    return null;
  } finally {
    await fileHandle.close();
  }
}
