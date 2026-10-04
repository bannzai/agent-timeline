/** 投稿を書いた agent の種類。 */
export type AgentKind = "claude-code" | "codex";

/** 投稿の書き手。human は人間の指示、agent は agent の返答、tool は agent のツール呼び出し。 */
export type PostAuthor = "human" | "agent" | "tool";

/** 投稿がどのセッションのものか。 */
export interface PostSession {
  agent: AgentKind;
  sessionId: string;
  /** セッションの作業ディレクトリ。ログに書かれていなければ null。 */
  projectDirectory: string | null;
  /** 発言の時点の git のブランチ。ログに書かれていなければ null。 */
  gitBranch: string | null;
}

/** タイムラインとスレッドに並ぶ 1 つの発言。Claude Code と Codex の発言を同じ形で表す。 */
export interface Post {
  /** ログの中の位置から作る (postId)、投稿を一意に指す ID。ログは追記だけされるため、同じ発言は同じ ID のままになる。 */
  id: string;
  session: PostSession;
  author: PostAuthor;
  text: string;
  /** 発言の日時。UTC の ISO 8601 (`Date.prototype.toISOString` の形) で、文字列の大小が日時の前後と一致する。 */
  timestamp: string;
}

/** 1 つのセッションのログのファイル。 */
export interface SessionLogFile {
  agent: AgentKind;
  sessionId: string;
  path: string;
}

// ツール呼び出しは画面で 1 行に畳むため、引数の全文は要らない。ファイルの書き込みの本文などで応答が膨らむのを防ぐ。
// 300 文字は、1 行に畳んだ時に見える幅より長く、読むファイルのパスや実行するコマンドがふつう収まる長さとして選んだ。
const toolCallTextMaxLength = 300;

/**
 * ログの中の位置から投稿の ID を作る。行とブロックの番号は桁をそろえて書き、
 * 同じセッションの ID の文字列の大小がログの中の前後と一致するようにする (同じ日時の投稿の順序に使う)。
 */
export function postId(
  agent: AgentKind,
  sessionId: string,
  lineIndex: number,
  blockIndex: number,
): string {
  // 1 つのログが 10 億行に、1 行のブロックが 1000 個に届くことは無いため、この桁数で大小が崩れない。
  return [
    agent,
    sessionId,
    String(lineIndex).padStart(9, "0"),
    String(blockIndex).padStart(3, "0"),
  ].join(":");
}

/** JSON の文字列を読む。読めなければ undefined を返す。 */
export function parseJson(jsonText: string): unknown {
  try {
    return JSON.parse(jsonText);
  } catch {
    return undefined;
  }
}

/** 値が JSON のオブジェクト (配列と null を除く) か。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** ログの日時を投稿の timestamp の形にする。日時として読めなければ null を返す。 */
export function postTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ツール呼び出しの投稿の本文を、ツールの名前と引数から作る。 */
export function toolCallText(toolName: string, toolInput: string): string {
  return `${toolName} ${toolInput}`.slice(0, toolCallTextMaxLength);
}
