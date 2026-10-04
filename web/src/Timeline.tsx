import { useCallback, useEffect, useRef, useState } from "react";
import type { Post, PostSession, TimelinePage } from "../../server/src/post.js";
import {
  AgentAvatar,
  HumanContext,
  PostHeader,
  PostText,
  Spinner,
  ToolCallLine,
} from "./PostParts";
import { threadPath } from "./route";

// 末尾がこの距離まで近づいたら続きを読み込む。投稿 4〜5 件ぶんの高さで、読み進める手が止まる前に次のページが届く。
const loadMoreRootMargin = "600px";

/** 続きの読み込みの状態。error は直前の読み込みに失敗し、もう一度読み込むボタンを出している状態。 */
type LoadState = "idle" | "loading" | "error";

/** ホームのタイムライン。全セッションの投稿を新しい順に 1 列で並べ、下まで読むと続きを読み込む。 */
export function Timeline({ onOpenThread }: { onOpenThread: (session: PostSession) => void }) {
  const [posts, setPosts] = useState<Post[]>([]);
  // 次に読み込むページのカーソル。undefined は最初のページをまだ読んでいない、null は続きが無いことを表す。
  // 画面の描き分けは state を、読み込みは ref を使う。ref は読み込みが終わった時点で変わるため、
  // 描き直す前に古い監視が通知しても、前のページのカーソルで同じページを読み直さない。
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  const nextCursorRef = useRef<string | null | undefined>(undefined);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  // 同じページを 2 回読まないための印。state と違い、読み込みを始めた直後の同じ描画の中でも値が変わる。
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  /** 次のページを読み、投稿の末尾に足す。読み込み中と、続きが無い時は何もしない。 */
  const loadNextPage = useCallback(() => {
    const cursor = nextCursorRef.current;
    if (loadingRef.current || cursor === null) {
      return;
    }
    loadingRef.current = true;
    setLoadState("loading");
    fetch(cursor === undefined ? "/api/posts" : `/api/posts?${new URLSearchParams({ cursor })}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`一覧の API が ${response.status} を返した`);
        }
        return (await response.json()) as TimelinePage;
      })
      .then((page) => {
        nextCursorRef.current = page.nextCursor;
        setPosts((previousPosts) => [...previousPosts, ...page.posts]);
        setNextCursor(page.nextCursor);
        setLoadState("idle");
      })
      .catch(() => setLoadState("error"))
      .finally(() => {
        loadingRef.current = false;
      });
  }, []);

  // 末尾の印が画面に近づいたら続きを読み込む。読み込みの状態が変わるたびに監視を作り直し、
  // 読んだページが短くて印がまだ見えている時も、作り直した監視の最初の通知で次のページを読む。
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel === null || loadState === "error") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadNextPage();
        }
      },
      { rootMargin: loadMoreRootMargin },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadNextPage, loadState]);

  // 相対時刻の基準。読み込むたびに描き直すため、描画の時点の時刻を使う。
  const now = new Date();
  return (
    <section aria-label="タイムライン">
      <header className="column-header">
        <h1 className="column-title">ホーム</h1>
      </header>
      {posts.map((post) => (
        <TimelinePost
          key={post.id}
          post={post}
          now={now}
          onOpen={() => onOpenThread(post.session)}
        />
      ))}
      {nextCursor === null && posts.length === 0 && (
        <div className="empty" data-testid="timeline-empty">
          <h2 className="empty-title">まだ投稿がありません</h2>
          <p className="empty-text">
            Claude Code か Codex でセッションを始めると
            <br />
            ここに会話が流れます
          </p>
        </div>
      )}
      {loadState === "error" && (
        <div className="load-error" role="alert">
          <p>読み込めませんでした</p>
          <button type="button" className="retry" onClick={loadNextPage}>
            もう一度読み込む
          </button>
        </div>
      )}
      {loadState === "loading" && <Spinner />}
      <div ref={sentinelRef} data-testid="timeline-end" />
    </section>
  );
}

/** タイムラインの 1 投稿。押すとそのセッションのスレッドを開く。 */
function TimelinePost({ post, now, onOpen }: { post: Post; now: Date; onOpen: () => void }) {
  return (
    <article
      className="post post-clickable"
      data-testid="post"
      data-post-id={post.id}
      data-agent={post.session.agent}
      data-author={post.author}
      data-session-id={post.session.sessionId}
      tabIndex={0}
      onClick={() => {
        // 本文の文字を選んでいる時は、コピーの操作として扱いスレッドを開かない。
        if ((window.getSelection()?.toString() ?? "") === "") {
          onOpen();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) {
          onOpen();
        }
      }}
    >
      {post.author === "human" && <HumanContext />}
      <div className="post-row">
        <AgentAvatar session={post.session} />
        <div className="post-main">
          <PostHeader
            post={post}
            now={now}
            timeHref={threadPath(post.session)}
            onTimeClick={onOpen}
          />
          {post.author === "tool" ? (
            <ToolCallLine post={post} />
          ) : (
            <PostText text={post.text} collapsible={true} />
          )}
        </div>
      </div>
    </article>
  );
}
