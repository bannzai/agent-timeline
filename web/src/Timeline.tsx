import { useCallback, useEffect, useRef, useState } from "react";
import {
  compareNewestFirst,
  type Post,
  type PostSession,
  type TimelinePage,
  timelineMaxLimit,
} from "../../server/src/post.js";
import { useLogChanges } from "./log-changes";
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
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  // 同じページを 2 回読まないための印。state と違い、読み込みを始めた直後の同じ描画の中でも値が変わる。
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // 表示していない新着。勝手に差し込まず、「新しい投稿を表示」を押した時に先頭へ並べる。
  const [newPosts, setNewPosts] = useState<Post[]>([]);
  // 表示中の投稿と続きのカーソル。新着を探した結果が届いた時点の値で、表示済みかを判定する。
  const loadedTimelineRef = useRef({ posts, nextCursor });
  useEffect(() => {
    loadedTimelineRef.current = { posts, nextCursor };
  }, [posts, nextCursor]);

  /** 次のページを読み、投稿の末尾に足す。読み込み中と、続きが無い時は何もしない。 */
  const loadNextPage = useCallback(() => {
    if (loadingRef.current || nextCursor === null) {
      return;
    }
    loadingRef.current = true;
    setLoadState("loading");
    fetch(
      nextCursor === undefined
        ? "/api/posts"
        : `/api/posts?${new URLSearchParams({ cursor: nextCursor })}`,
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`一覧の API が ${response.status} を返した`);
        }
        return (await response.json()) as TimelinePage;
      })
      .then((page) => {
        setPosts((previousPosts) => [...previousPosts, ...page.posts]);
        setNextCursor(page.nextCursor);
        setLoadState("idle");
      })
      .catch(() => setLoadState("error"))
      .finally(() => {
        loadingRef.current = false;
      });
  }, [nextCursor]);

  // 末尾の印が画面に近づいたら続きを読み込む。ページを読むたびに監視を作り直し、
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

  /**
   * 最新の投稿を読み、表示中の投稿にも新着にも無い投稿を新着に足す。何度呼んでも同じ投稿は 1 度しか新着にならない。
   * 読み込んだ範囲より古い投稿は、下まで読んだ時の続きの読み込みで並ぶため新着にしない。
   * 失敗した時は、次の知らせで探し直すため何もしない。
   */
  const checkNewPosts = useCallback(() => {
    // 一覧の API が 1 回で返せる最も多い件数を読み、知らせの間隔 (約 1 秒) に増えた投稿を取りこぼさないようにする。
    // 1 回の間にこれより多くの投稿が増えると、溢れた分は読み直すまでタイムラインに出ない。
    fetch(`/api/posts?${new URLSearchParams({ limit: String(timelineMaxLimit) })}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`一覧の API が ${response.status} を返した`);
        }
        return (await response.json()) as TimelinePage;
      })
      .then((page) => {
        setNewPosts((previousNewPosts) => {
          const { posts: loadedPosts, nextCursor: loadedNextCursor } = loadedTimelineRef.current;
          const knownPostIds = new Set(
            [...loadedPosts, ...previousNewPosts].map((post) => post.id),
          );
          // 読み込んだ範囲の最も古い投稿。続きが無い (全件を読んだ) 時は範囲の下限が無いため undefined。
          const oldestPost = loadedNextCursor === null ? undefined : loadedPosts.at(-1);
          const arrivedPosts = page.posts.filter(
            (post) =>
              !knownPostIds.has(post.id) &&
              (oldestPost === undefined || compareNewestFirst(post, oldestPost) < 0),
          );
          return arrivedPosts.length === 0
            ? previousNewPosts
            : [...previousNewPosts, ...arrivedPosts];
        });
      })
      .catch(() => {});
  }, []);

  // 最初のページを読んでから知らせを受ける。つながった時の読み直しで、最初のページの後に増えた投稿を拾う。
  useLogChanges(checkNewPosts, nextCursor !== undefined);

  /** 新着を日時の順に投稿へ混ぜ、先頭から読めるよう一番上へ移る。 */
  const showNewPosts = () => {
    setPosts((previousPosts) => {
      const shownPostIds = new Set(previousPosts.map((post) => post.id));
      return [...previousPosts, ...newPosts.filter((post) => !shownPostIds.has(post.id))].sort(
        compareNewestFirst,
      );
    });
    setNewPosts([]);
    window.scrollTo(0, 0);
  };

  // 相対時刻の基準。読み込むたびに描き直すため、描画の時点の時刻を使う。
  const now = new Date();
  return (
    <section aria-label="タイムライン">
      <header className="column-header">
        <h1 className="column-title">ホーム</h1>
      </header>
      {newPosts.length > 0 && (
        <div className="new-posts-bar">
          <button type="button" className="new-posts-button" onClick={showNewPosts}>
            <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
              <path d="M12 3.6 19.7 11.3l-1.4 1.4L13 7.4V20h-2V7.4l-5.3 5.3-1.4-1.4L12 3.6Z" />
            </svg>
            {newPosts.length} 件の新しい投稿を表示
          </button>
        </div>
      )}
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
