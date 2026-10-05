import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createLogWatcher } from "./log-watcher.js";
import { type AgentKind, isRecord, type SessionsChangedEvent, timelineMaxLimit } from "./post.js";
import {
  decodeTimelineCursor,
  type LogRoots,
  readProjects,
  readThread,
  readTimeline,
} from "./timeline.js";
import { findReplyTarget, type ReplyCommands, sendReply } from "./tmux.js";
import { appendUsageEvent } from "./usage-log.js";

// タイムラインの 1 画面に並ぶ件数より多く、1 回の応答でログを読む量を抑えられる件数にするため。
const timelineDefaultLimit = 50;
// サーバーは 127.0.0.1 だけで待ち受けるため、正しいリクエストの Host はこのどちらかになる。
const localHostnames = new Set(["127.0.0.1", "localhost"]);
// 発言が 1 秒ほどでタイムラインに流れ、流し見て遅れを感じない間隔にするため。
// 1 回に見るのはファイルの一覧と大きさ・最終更新の日時だけで、ファイルの中身は読まない。
const logPollIntervalMs = 1000;
// 1 行の指示として十分な長さで、tmux に渡す 1 つの引数が OS の上限 (Linux は 128 KiB) に届かない長さとして選んだ。
const replyTextMaxLength = 10_000;

/** createApp に渡す設定。 */
export interface AppOptions {
  /** 読むセッションのログのルート。 */
  logRoots: LogRoots;
  /** 利用記録 (usage.jsonl) を置くディレクトリ。 */
  usageLogDirectory: string;
  /** 返信の送信に使う tmux と ps。 */
  replyCommands: ReplyCommands;
}

/** URL の agent の部分が、知っている agent の種類か。 */
function isAgentKind(agent: string): agent is AgentKind {
  return agent === "claude-code" || agent === "codex";
}

/** Origin ヘッダーが、リクエストの URL と同じオリジンか。Origin が無い・読めない (`null` など) 時は false を返す。 */
function isSameOrigin(origin: string | undefined, requestUrl: string): boolean {
  return (
    origin !== undefined &&
    URL.canParse(origin) &&
    new URL(origin).origin === new URL(requestUrl).origin
  );
}

/** agent-timeline の HTTP API を返す。静的ファイルの配信と待ち受けを含まないため、テストから直接呼べる。 */
export function createApp(options: AppOptions): Hono {
  const app = new Hono();
  const logWatcher = createLogWatcher(options.logRoots, logPollIntervalMs);
  // 最後に受け付けた返信の送信。次の返信は、これが終わってから送る。
  let replySendQueue: Promise<unknown> = Promise.resolve();

  // 会話のログを返すため、Host がこのマシンでないリクエストは拒否する。ブラウザで開いた別のサイトが
  // 自分のドメインを 127.0.0.1 に向け直して (DNS rebinding) 同じオリジンとして読むのを防ぐ (documents/PROJECT.md「制約」)。
  // @hono/node-server はリクエストの URL を Host ヘッダーから組み立てる。
  app.use("/api/*", async (c, next) => {
    if (!localHostnames.has(new URL(c.req.url).hostname)) {
      return c.json({ error: "Host がこのマシンではない" }, 403);
    }
    await next();
  });

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  // 全セッションの投稿を新しい順に返す。`limit` は件数の上限、`cursor` は直前の応答の `nextCursor`。
  // `project` を渡すとそのプロジェクトの、さらに `worktree` を渡すとその worktree のセッションの投稿だけを返す。
  app.get("/api/posts", async (c) => {
    const limitText = c.req.query("limit");
    const limit = limitText === undefined ? timelineDefaultLimit : Number(limitText);
    if (!Number.isInteger(limit) || limit < 1 || limit > timelineMaxLimit) {
      return c.json({ error: `limit は 1 から ${timelineMaxLimit} の整数で指定する` }, 400);
    }
    const cursorText = c.req.query("cursor");
    const cursor = cursorText === undefined ? null : decodeTimelineCursor(cursorText);
    if (cursorText !== undefined && cursor === null) {
      return c.json({ error: "cursor が読めない" }, 400);
    }
    const projectName = c.req.query("project");
    const worktreeName = c.req.query("worktree");
    if (projectName === undefined && worktreeName !== undefined) {
      return c.json({ error: "worktree は project と一緒に指定する" }, 400);
    }
    const filter =
      projectName === undefined ? undefined : { projectName, worktreeName: worktreeName ?? null };
    return c.json(await readTimeline(options.logRoots, { limit, cursor, filter }));
  });

  // ログがあるプロジェクトと、その worktree を最近使った順に返す。
  app.get("/api/projects", async (c) => c.json({ projects: await readProjects(options.logRoots) }));

  // 1 つのセッションの投稿を古い順に返す。`reply` は、このセッションへ返信できるかと、できない時の理由。
  app.get("/api/sessions/:agent/:sessionId/posts", async (c) => {
    const agent = c.req.param("agent");
    if (!isAgentKind(agent)) {
      return c.json({ error: "セッションが見つからない" }, 404);
    }
    const posts = await readThread(options.logRoots, agent, c.req.param("sessionId"));
    if (posts === null) {
      return c.json({ error: "セッションが見つからない" }, 404);
    }
    // 作業ディレクトリはセッションの途中で変わりうるため、最後の発言の時点のものを使う。
    const projectDirectory = posts.at(-1)?.session.projectDirectory ?? null;
    return c.json({
      posts,
      reply: await findReplyTarget(options.replyCommands, agent, projectDirectory),
    });
  });

  // 本文 (`{"text": "..."}`) を、セッションが動いている tmux の pane へ入力して Enter を送る。
  app.post("/api/sessions/:agent/:sessionId/replies", async (c) => {
    // 返信はこのマシンでコマンドを打つのと同じ力を持つため、このアプリの画面からのリクエストだけを受け付ける (documents/PROJECT.md「制約」)。
    // Host は上の検査でこのマシンに限られるため、Origin が Host と同じなら、このマシンのこのアプリの画面からのリクエストになる。
    // 待ち受けのポートではなく Host と比べるのは、`npm run dev` では画面と API が vite の同じオリジンから届くため。
    if (!isSameOrigin(c.req.header("Origin"), c.req.url)) {
      return c.json({ error: "Origin がこのアプリではない" }, 403);
    }
    // 別のサイトがプリフライトなしで送れる形式 (フォームの送信・text/plain) を受け付けない。
    if (c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      return c.json({ error: "Content-Type は application/json にする" }, 415);
    }
    const body: unknown = await c.req.json().catch(() => undefined);
    const text = isRecord(body) ? body.text : undefined;
    if (typeof text !== "string" || text.trim() === "" || text.length > replyTextMaxLength) {
      return c.json(
        { error: `本文は 1 文字以上 ${replyTextMaxLength} 文字以下で送ってください` },
        400,
      );
    }
    // 改行は tmux に渡ると Enter として届き、制御文字は端末やエージェントの操作になるため、1 行の文字だけを受け付ける。
    // Unicode の行区切り・段落区切り (U+2028・U+2029) も、受け取る側が改行として扱いうるため受け付けない。
    if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(text)) {
      return c.json({ error: "改行や制御文字を含む本文は送れません" }, 400);
    }

    const agent = c.req.param("agent");
    if (!isAgentKind(agent)) {
      return c.json({ error: "セッションが見つからない" }, 404);
    }
    const posts = await readThread(options.logRoots, agent, c.req.param("sessionId"));
    if (posts === null) {
      return c.json({ error: "セッションが見つからない" }, 404);
    }
    // スレッドを開いた後に pane が閉じられた・別のプロセスに変わった時に送らないため、送る直前に対応付けをやり直す。
    // 同時に届いた返信は 1 つずつ送る。並べて送ると、2 つの本文が Enter の前に同じ pane の入力欄でつながりうるため。
    const replySend = replySendQueue.then(() =>
      sendReply(options.replyCommands, agent, posts.at(-1)?.session.projectDirectory ?? null, text),
    );
    replySendQueue = replySend.catch(() => undefined);
    const replySendResult = await replySend;
    if (replySendResult.status === "unavailable") {
      return c.json({ error: replySendResult.reason }, 409);
    }
    if (replySendResult.status === "failed") {
      return c.json({ error: replySendResult.reason, textTyped: replySendResult.textTyped }, 502);
    }
    // 利用記録は判定のための計測で、本文は書かない。書けなくても返信は届いているため、警告だけ出して成功を返す。
    await appendUsageEvent(options.usageLogDirectory, "reply", new Date()).catch(
      (error: unknown) => {
        console.warn(`agent-timeline: 利用記録を書けなかった (${String(error)})`);
      },
    );
    return c.json({ status: "sent" });
  });

  // ログの変化を Server-Sent Events で知らせる。見張りの基準ができた時に `ready` を送り、その後は
  // ログが追記されたか新しく現れたセッションを `sessions-changed` で送る。画面は ready を受けたら読み直し、
  // つながる前とつながっていない間の変化を拾う。
  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const aborted = new Promise<void>((resolve) => stream.onAbort(resolve));
      const unsubscribe = await logWatcher.subscribe((changedSessions) => {
        void stream.writeSSE({
          event: "sessions-changed",
          data: JSON.stringify({ sessions: changedSessions } satisfies SessionsChangedEvent),
        });
      });
      // ブラウザは data が空のイベントを届けないため、空のオブジェクトを入れる。
      await stream.writeSSE({ event: "ready", data: "{}" });
      // コールバックが終わるとつながりが閉じるため、ブラウザが閉じるまで待つ。
      await aborted;
      unsubscribe();
    }),
  );

  return app;
}
