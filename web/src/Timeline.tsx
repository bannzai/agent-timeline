import { useCallback, useEffect, useRef, useState } from "react";
import {
  compareNewestFirst,
  type Post,
  type PostSession,
  type TimelinePage,
  timelineMaxLimit,
} from "../../server/src/post.js";
import type { TimelineFilter } from "../../server/src/project.js";
import { useLogChanges } from "./log-changes";
import {
  AgentAvatar,
  HumanContext,
  PostHeader,
  PostText,
  Spinner,
  ToolCallLine,
} from "./PostParts";
import { groupConsecutiveSessionPosts } from "./post-groups";
import { threadPath } from "./route";
import { conversationAuthors, useShowToolCalls } from "./show-tool-calls";

// 末尾がこの距離まで近づいたら続きを読み込む。投稿 4〜5 件ぶんの高さで、読み進める手が止まる前に次のページが届く。
const loadMoreRootMargin = "600px";

/** 続きの読み込みの状態。error は直前の読み込みに失敗し、もう一度読み込むボタンを出している状態。 */
type LoadState = "idle" | "loading" | "error";

/** 一覧の API の条件。 */
interface PostsQuery {
  /** あれば、そのプロジェクトか worktree のセッションの投稿に絞る。 */
  filter: TimelineFilter | null;
  /** false なら、ツール呼び出しを除いた会話の投稿に絞る。 */
  showToolCalls: boolean;
}

/** 一覧の API の URL。params は条件と一緒に渡すクエリ。 */
function postsUrl(postsQuery: PostsQuery, params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  if (postsQuery.filter !== null) {
    query.set("project", postsQuery.filter.projectName);
    if (postsQuery.filter.worktreeName !== null) {
      query.set("worktree", postsQuery.filter.worktreeName);
    }
  }
  // ツール呼び出しを出さない時はサーバーで除き、ページの件数がツール呼び出しで埋まらないようにする。
  if (!postsQuery.showToolCalls) {
    query.set("authors", conversationAuthors);
  }
  return `/api/posts?${query}`;
}

/**
 * タイムライン。投稿を新しい順に 1 列で並べ、下まで読むと続きを読み込む。filter が null なら全セッションの投稿を、
 * あればそのプロジェクトか worktree のセッションの投稿だけを並べる。ツール呼び出しの投稿は、表示の設定が
 * ON の時だけ並べる。filter と設定を替える時は、key を替えて作り直す。
 */
export function Timeline({
  filter,
  onOpenThread,
}: {
  filter: TimelineFilter | null;
  onOpenThread: (session: PostSession) => void;
}) {
  const showToolCalls = useShowToolCalls();
  // 読み込みの関数は作った時の条件を使い続ける。条件は作り直すまで変わらない (上の説明) ため、最初の値を持つ。
  const postsQueryRef = useRef<PostsQuery>({ filter, showToolCalls });
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
  // 表示していない新着。勝手に差し込まず、「新しい投稿を表示」を押した時に先頭へ並べる。
  const [newPosts, setNewPosts] = useState<Post[]>([]);
  // 表示中の投稿と続きのカーソル。新着を探した結果が届いた時点の値で、表示済みかを判定する。
  const loadedTimelineRef = useRef({ posts, nextCursor });
  useEffect(() => {
    loadedTimelineRef.current = { posts, nextCursor };
  }, [posts, nextCursor]);

  /** 次のページを読み、投稿の末尾に足す。読み込み中と、続きが無い時は何もしない。 */
  const loadNextPage = useCallback(() => {
    const cursor = nextCursorRef.current;
    if (loadingRef.current || cursor === null) {
      return;
    }
    loadingRef.current = true;
    setLoadState("loading");
    fetch(postsUrl(postsQueryRef.current, cursor === undefined ? {} : { cursor }))
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

  // 新着を探す読み込みの最中か。
  const checkingNewPostsRef = useRef(false);
  // 新着を探す読み込みの最中に checkNewPosts が呼ばれたか。
  const newPostsCheckRequestedRef = useRef(false);

  /**
   * 最新の投稿を読み、表示中の投稿にも新着にも無い投稿を新着に足す。何度呼んでも同じ投稿は 1 度しか新着にならない。
   * 読み込んだ範囲より古い投稿は、下まで読んだ時の続きの読み込みで並ぶため新着にしない。
   * 失敗した時は、次の知らせで探し直すため何もしない。読み込みの最中に呼ばれた時は、終わった後で 1 度だけ探し直す。
   * 読み込みが知らせの間隔より長くかかる時に、読み込みが積み重なってサーバーの負荷を増やすのを防ぐ。
   * 型を書くのは、終わった後の探し直しで自分を呼び、型の推論が自分自身を参照するため。
   */
  const checkNewPosts: () => void = useCallback(() => {
    if (checkingNewPostsRef.current) {
      newPostsCheckRequestedRef.current = true;
      return;
    }
    checkingNewPostsRef.current = true;
    // 一覧の API が 1 回で返せる最も多い件数を読み、知らせの間隔 (約 1 秒) に増えた投稿を取りこぼさないようにする。
    // 1 回の間にこれより多くの投稿が増えると、溢れた分は読み直すまでタイムラインに出ない。
    fetch(postsUrl(postsQueryRef.current, { limit: String(timelineMaxLimit) }))
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
      .catch(() => {})
      .finally(() => {
        checkingNewPostsRef.current = false;
        if (newPostsCheckRequestedRef.current) {
          newPostsCheckRequestedRef.current = false;
          checkNewPosts();
        }
      });
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
      {groupConsecutiveSessionPosts(posts).flatMap((group) =>
        group.map((post, postIndex) => (
          <TimelinePost
            key={post.id}
            post={post}
            now={now}
            continuesFromAbove={postIndex > 0}
            continuesBelow={postIndex < group.length - 1}
            onOpen={() => onOpenThread(post.session)}
          />
        )),
      )}
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

/**
 * タイムラインの 1 投稿。押すとそのセッションのスレッドを開く。
 * 同じセッションの投稿が続くまとまりでは、先頭の投稿だけがアイコンと投稿者を出し、まとまりの投稿をアイコンの列の縦線でつなぐ。
 * continuesFromAbove は上の投稿が同じまとまりにあること、continuesBelow は下の投稿が同じまとまりにあることを表す。
 */
function TimelinePost({
  post,
  now,
  continuesFromAbove,
  continuesBelow,
  onOpen,
}: {
  post: Post;
  now: Date;
  continuesFromAbove: boolean;
  continuesBelow: boolean;
  onOpen: () => void;
}) {
  return (
    <article
      className={`post post-clickable${continuesFromAbove ? " timeline-post-continued" : ""}${continuesBelow ? " timeline-post-continues" : ""}`}
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
      {post.author === "human" && !continuesFromAbove && <HumanContext />}
      <div className="post-row">
        <div className="avatar-column">
          {!continuesFromAbove && <AgentAvatar session={post.session} />}
          {(continuesFromAbove || continuesBelow) && (
            <div className="thread-line" data-testid="thread-line" />
          )}
        </div>
        <div className="post-main">
          {/* まとまりの続きでは、縦線を途切れさせないよう、人間の指示の行をアイコンの列の上ではなく本文の上に出す。 */}
          {continuesFromAbove && post.author === "human" && <HumanContext />}
          {!continuesFromAbove && (
            <PostHeader
              post={post}
              now={now}
              timeHref={threadPath(post.session)}
              onTimeClick={onOpen}
            />
          )}
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
