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
  /**
   * author が tool の投稿の、ツールの結果の先頭。tool でない投稿、結果がまだログに無い投稿、
   * 文を持たない結果 (画像だけの結果など) の投稿は null。
   */
  toolResult: string | null;
  /** 発言の日時。UTC の ISO 8601 (`Date.prototype.toISOString` の形) で、文字列の大小が日時の前後と一致する。 */
  timestamp: string;
}

/** 一覧の 1 ページ。nextCursor は続きを取る時に一覧の API へ渡す値で、続きがある時だけ持つ。 */
export interface TimelinePage {
  posts: Post[];
  nextCursor: string | null;
}

/** 一覧の API (`/api/posts`) の limit の上限。画面が一度に描く件数として十分で、1 回の応答が大きくなりすぎない値にした。 */
export const timelineMaxLimit = 200;

/** 自動更新の API (`/api/events`) が送る `sessions-changed` の data。sessions は、ログが追記されたか新しく現れたセッション。 */
export interface SessionsChangedEvent {
  sessions: Pick<PostSession, "agent" | "sessionId">[];
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
// ツールの結果は、スレッドでツール呼び出しを開いた時に要約として読む。ファイルの読み取りの全文などで応答が膨らむのを防ぐ。
// 500 文字は、エラーの 1 行目やコマンドの出力の冒頭の数行が収まり、開いた画面が結果で埋まらない長さとして選んだ。
const toolResultTextMaxLength = 500;

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

/** 文字列を UTF-16 のコード単位の順に比べる。ISO 8601 の UTC の日時は、この順が日時の前後と一致する。 */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 投稿を新しい順に並べる比較関数。同じ日時の投稿 (1 行のログが本文とツール呼び出しを持つ時など) は id で順序を決め、
 * 一覧のカーソルの境界で投稿が抜けたり重なったりしないようにする。
 */
export function compareNewestFirst(
  a: Pick<Post, "timestamp" | "id">,
  b: Pick<Post, "timestamp" | "id">,
): number {
  return compareText(b.timestamp, a.timestamp) || compareText(b.id, a.id);
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
  return sliceCharacters(`${toolName} ${toolInput}`, toolCallTextMaxLength);
}

/** 文の先頭の maxLength 文字を返す。UTF-16 のコード単位ではなく文字 (コードポイント) で数え、絵文字を途中で切らない。 */
function sliceCharacters(text: string, maxLength: number): string {
  return Array.from(text).slice(0, maxLength).join("");
}

/**
 * ツールの結果を、投稿の toolResult の形にする。結果は文字列か、`text` を持つ要素の配列で書かれる。
 * 文を持たない結果 (画像だけの結果・知らない形の結果など) は null を返す。
 */
export function toolResultText(toolOutput: unknown): string | null {
  if (typeof toolOutput === "string") {
    return toolOutput === "" ? null : sliceCharacters(toolOutput, toolResultTextMaxLength);
  }
  if (!Array.isArray(toolOutput)) {
    return null;
  }
  const itemTexts = toolOutput.map(contentItemText).filter((itemText) => itemText !== null);
  return itemTexts.length === 0
    ? null
    : sliceCharacters(itemTexts.join("\n"), toolResultTextMaxLength);
}

/** 発言やツールの結果の配列の要素 (`{ type, text }`) の文。文を持たない要素は null を返す。 */
export function contentItemText(item: unknown): string | null {
  return isRecord(item) && typeof item.text === "string" ? item.text : null;
}
