import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentKind, Post } from "../../server/src/post.js";
import { projectName } from "./format";
import { useLogChanges } from "./log-changes";
import {
  AgentAvatar,
  HumanContext,
  PostHeader,
  PostText,
  Spinner,
  ToolCallDetails,
} from "./PostParts";

/** スレッドの API の読み込みの状態。not-found はセッションが無い (404) ことを表す。 */
type ThreadState =
  | { status: "loading" }
  | { status: "loaded"; posts: Post[] }
  | { status: "not-found" }
  | { status: "error" };

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

  // 終わった後の読み直しで自分を呼ぶため、型を書いて推論が自分自身を参照しないようにする。
  /**
   * スレッドを読み、読めた投稿で表示を置き換える。投稿を表示している時に読み込みに失敗した時は、表示中の投稿を残す。
   * 読み込み中に呼ばれた時は、今の読み込みを止めずに終わった後で 1 度だけ読み直す。読み込みが知らせの間隔より
   * 長くかかる時に、知らせのたびに読み込みを止めて表示が更新されなくなるのを防ぐ。
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
        const { posts } = (await response.json()) as { posts: Post[] };
        setThreadState({ status: "loaded", posts });
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
      <header className="column-header column-header-with-back">
        <button type="button" className="back-button" aria-label="戻る" onClick={onBack}>
          <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
            <path d="M7.4 11H20v2H7.4l5.3 5.3-1.4 1.4L3.6 12l7.7-7.7 1.4 1.4L7.4 11Z" />
          </svg>
        </button>
        <div>
          <h1 className="column-title">スレッド</h1>
          {firstPost !== undefined && (
            <div className="column-subtitle">{projectName(firstPost.session)}</div>
          )}
        </div>
      </header>
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
    </section>
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
