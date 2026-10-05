import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { AgentKind, Post, ReplyTarget } from "../../server/src/post.js";
import { projectName } from "./format";
import { useLogChanges } from "./log-changes";
import {
  AgentAvatar,
  BackHeader,
  HumanContext,
  PostHeader,
  PostText,
  Spinner,
  ToolCallDetails,
} from "./PostParts";

/** スレッドの API の読み込みの状態。not-found はセッションが無い (404) ことを表す。 */
type ThreadState =
  | { status: "loading" }
  | { status: "loaded"; posts: Post[]; reply: ReplyTarget }
  | { status: "not-found" }
  | { status: "error" };

/** 返信の送信の状態。failed は届かなかった理由を持つ。 */
type ReplySendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent" }
  | { status: "failed"; reason: string };

/** 1 つのセッションのスレッド。セッションの発言を古い順に、返信の連なりとして並べる。 */
export function Thread({
  agent,
  sessionId,
  onBack,
}: {
  agent: AgentKind;
  sessionId: string;
  onBack: () => void;
}) {
  const [threadState, setThreadState] = useState<ThreadState>({ status: "loading" });
  // 読み込み中の読み込みを、セッションが替わった時と画面を閉じた時に止めるためのもの。読み込んでいない間は null。
  const loadControllerRef = useRef<AbortController | null>(null);
  // 読み込み中に loadThread が呼ばれたか。
  const reloadRequestedRef = useRef(false);

  /**
   * スレッドを読み、読めた投稿で表示を置き換える。投稿を表示している時に読み込みに失敗した時は、表示中の投稿を残す。
   * 読み込み中に呼ばれた時は、今の読み込みを止めずに終わった後で 1 度だけ読み直す。読み込みが知らせの間隔より
   * 長くかかる時に、知らせのたびに読み込みを止めて表示が更新されなくなるのを防ぐ。
   * 型を書くのは、終わった後の読み直しで自分を呼び、型の推論が自分自身を参照するため。
   */
  const loadThread: () => void = useCallback(() => {
    if (loadControllerRef.current !== null) {
      reloadRequestedRef.current = true;
      return;
    }
    const controller = new AbortController();
    loadControllerRef.current = controller;
    fetch(`/api/sessions/${agent}/${encodeURIComponent(sessionId)}/posts`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) {
          setThreadState({ status: "not-found" });
          return;
        }
        if (!response.ok) {
          throw new Error(`スレッドの API が ${response.status} を返した`);
        }
        const { posts, reply } = (await response.json()) as { posts: Post[]; reply: ReplyTarget };
        setThreadState({ status: "loaded", posts, reply });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setThreadState((previousState) =>
            previousState.status === "loaded" ? previousState : { status: "error" },
          );
        }
      })
      .finally(() => {
        // 止めた読み込みの後始末は、止めた側 (下の useEffect の後始末) が済ませている。
        if (controller.signal.aborted) {
          return;
        }
        loadControllerRef.current = null;
        if (reloadRequestedRef.current) {
          reloadRequestedRef.current = false;
          loadThread();
        }
      });
  }, [agent, sessionId]);

  useEffect(() => {
    setThreadState({ status: "loading" });
    loadThread();
    return () => {
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
      reloadRequestedRef.current = false;
    };
  }, [loadThread]);

  // このセッションのログが追記された時と、知らせにつながった時に読み直し、増えた発言を末尾に並べる。
  useLogChanges((changedSessions) => {
    if (
      changedSessions === null ||
      changedSessions.some((session) => session.agent === agent && session.sessionId === sessionId)
    ) {
      loadThread();
    }
  }, true);

  const firstPost = threadState.status === "loaded" ? threadState.posts[0] : undefined;
  // 相対時刻の基準。読み込むたびに描き直すため、描画の時点の時刻を使う。
  const now = new Date();
  return (
    <section aria-label="スレッド">
      <BackHeader
        title="スレッド"
        subtitle={firstPost === undefined ? null : projectName(firstPost.session)}
        onBack={onBack}
      />
      {threadState.status === "loading" && <Spinner />}
      {threadState.status === "not-found" && (
        <div className="empty" data-testid="thread-not-found">
          <h2 className="empty-title">セッションが見つかりません</h2>
          <p className="empty-text">ログが消えたか URL が違います</p>
        </div>
      )}
      {threadState.status === "error" && (
        <div className="load-error" role="alert">
          <p>読み込めませんでした</p>
        </div>
      )}
      {threadState.status === "loaded" &&
        threadState.posts.map((post, postIndex) => (
          <ThreadPost
            key={post.id}
            post={post}
            now={now}
            hasReply={postIndex < threadState.posts.length - 1}
          />
        ))}
      {threadState.status === "loaded" &&
        (threadState.reply.available ? (
          <ReplyComposer agent={agent} sessionId={sessionId} />
        ) : (
          <p className="reply-unavailable" data-testid="reply-unavailable">
            {threadState.reply.reason}
          </p>
        ))}
    </section>
  );
}

/** スレッドの末尾の返信欄。書いた 1 行を、このセッションが動いている tmux の pane へ指示として送る。 */
function ReplyComposer({ agent, sessionId }: { agent: AgentKind; sessionId: string }) {
  const [text, setText] = useState("");
  const [sendState, setSendState] = useState<ReplySendState>({ status: "idle" });

  /** 返信欄の送信。本文を返信の API へ送り、結果を送信の状態に写す。送信中と空の本文では何もしない。 */
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (text.trim() === "" || sendState.status === "sending") {
      return;
    }
    setSendState({ status: "sending" });
    fetch(`/api/sessions/${agent}/${encodeURIComponent(sessionId)}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
      .then(async (response) => {
        if (response.ok) {
          setText("");
          setSendState({ status: "sent" });
          return;
        }
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          textTyped?: boolean;
        } | null;
        // 本文が pane の入力欄に残っている時に同じ本文を送り直すと、入力欄で 2 つがつながるため、返信欄からは消す。
        if (body?.textTyped === true) {
          setText("");
        }
        setSendState({
          status: "failed",
          reason: body?.error ?? `サーバーが ${response.status} を返しました`,
        });
      })
      .catch(() => {
        setSendState({ status: "failed", reason: "サーバーにつながりませんでした" });
      });
  };

  return (
    <div className="reply-composer">
      <form className="reply-form" data-testid="reply-form" onSubmit={onSubmit}>
        <input
          className="reply-input"
          type="text"
          aria-label="返信"
          placeholder="返信をポスト"
          value={text}
          // 届いた時に入力を空にするため、送信中に書き足した文が送られないまま消えないよう、送信中は書き換えられなくする。
          readOnly={sendState.status === "sending"}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // 日本語入力の変換を確定する Enter で送らない。
            if (
              event.key === "Enter" &&
              (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
            ) {
              event.preventDefault();
            }
          }}
        />
        <button
          type="submit"
          className="reply-button"
          disabled={text.trim() === "" || sendState.status === "sending"}
        >
          返信
        </button>
      </form>
      {/* スクリーンリーダーが送信の結果を読み上げるよう、状態の領域は送る前から置いておく。 */}
      <p
        className="reply-status"
        role="status"
        data-testid="reply-status"
        data-status={sendState.status}
        hidden={sendState.status === "idle"}
      >
        {sendState.status === "sending" && "送信中"}
        {sendState.status === "sent" && "届きました"}
        {sendState.status === "failed" && `届きませんでした (${sendState.reason})`}
      </p>
    </div>
  );
}

/** スレッドの 1 投稿。次の投稿がある時は、アイコンの下から次の投稿へ線を引いて返信の連なりにする。 */
function ThreadPost({ post, now, hasReply }: { post: Post; now: Date; hasReply: boolean }) {
  return (
    <article
      className={`post thread-post${hasReply ? " thread-post-with-reply" : ""}`}
      data-testid="thread-post"
      data-post-id={post.id}
      data-author={post.author}
      data-session-id={post.session.sessionId}
    >
      {post.author === "human" && <HumanContext />}
      <div className="post-row">
        <div className="avatar-column">
          <AgentAvatar session={post.session} />
          {hasReply && <div className="thread-line" />}
        </div>
        <div className="post-main">
          <PostHeader post={post} now={now} />
          {post.author === "tool" ? (
            <ToolCallDetails post={post} />
          ) : (
            <PostText text={post.text} collapsible={false} />
          )}
        </div>
      </div>
    </article>
  );
}
