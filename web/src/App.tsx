import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PostSession } from "../../server/src/post.js";
import { type Route, routeFromPath, threadPath } from "./route";
import { Thread } from "./Thread";
import { Timeline } from "./Timeline";

/** スレッドへ移った時に履歴へ入れる印。戻るボタンが、ブラウザの戻ると同じくタイムラインへ戻れるかを知るために使う。 */
interface ThreadHistoryState {
  /** タイムラインの投稿を押してスレッドへ移ったこと。履歴の 1 つ前がタイムラインであることを表す。 */
  openedFromTimeline: true;
}

/** 履歴の state が、タイムラインからスレッドへ移った時に入れたものか。 */
function isOpenedFromTimeline(state: unknown): state is ThreadHistoryState {
  return typeof state === "object" && state !== null && "openedFromTimeline" in state;
}

/**
 * 画面のルート。URL のパスからタイムラインとスレッドを切り替える。
 * スレッドを開いている間もタイムラインを隠して残し、戻った時に読み込んだ投稿と読んでいた位置をそのまま出す。
 */
export function App() {
  const [route, setRoute] = useState<Route>(() => routeFromPath(window.location.pathname));
  // スレッドを開く直前のタイムラインのスクロールの位置。
  const timelineScrollYRef = useRef(0);
  // いま出している画面。ブラウザの戻る・進むの通知で、離れる画面がタイムラインかを知るために使う。
  const currentScreenRef = useRef(route.screen);

  useEffect(() => {
    // 戻った時のスクロールの位置は、隠して残したタイムラインに合わせてこの画面が戻す。
    window.history.scrollRestoration = "manual";
    // スレッドとして読めない URL (`/sessions/gemini/abc` など) はタイムラインを出すため、URL もタイムラインの `/` に直す。
    if (
      routeFromPath(window.location.pathname).screen === "home" &&
      window.location.pathname !== "/"
    ) {
      window.history.replaceState(null, "", "/");
    }
    /**
     * ブラウザの戻る・進むで変わった URL を、画面の場所に写す。タイムラインから離れる時は、読んでいた位置を残す
     * (scrollRestoration が manual のため、通知の時点のスクロールの位置はまだタイムラインのもの)。
     */
    const onPopState = () => {
      if (currentScreenRef.current === "home") {
        timelineScrollYRef.current = window.scrollY;
      }
      setRoute(routeFromPath(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useLayoutEffect(() => {
    currentScreenRef.current = route.screen;
    window.scrollTo(0, route.screen === "home" ? timelineScrollYRef.current : 0);
  }, [route]);

  /** セッションのスレッドへ移り、履歴に積む。ブラウザの戻るでタイムラインへ戻れる。 */
  const openThread = (session: PostSession) => {
    timelineScrollYRef.current = window.scrollY;
    window.history.pushState(
      { openedFromTimeline: true } satisfies ThreadHistoryState,
      "",
      threadPath(session),
    );
    setRoute(routeFromPath(threadPath(session)));
  };

  /** スレッドからタイムラインへ戻る。 */
  const backToTimeline = () => {
    if (isOpenedFromTimeline(window.history.state)) {
      window.history.back();
      return;
    }
    // スレッドの URL を直接開いた時は、履歴の前がこのアプリではないため、同じ履歴の位置でタイムラインに替える。
    window.history.replaceState(null, "", "/");
    setRoute({ screen: "home" });
  };

  /** メニューのホームへのリンクを押した時の処理。ページを読み直さず、タイムラインへ戻る。 */
  const onHomeLinkClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // 修飾キー付きのクリックは、ブラウザの既定 (新しいタブで開くなど) に任せる。
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    if (route.screen !== "home") {
      backToTimeline();
    }
  };

  return (
    <div className="layout">
      <nav className="side-nav" aria-label="メニュー">
        <a className="side-nav-brand" href="/" onClick={onHomeLinkClick}>
          <span className="brand-mark" aria-hidden="true">
            ◎
          </span>
          <span>agent-timeline</span>
        </a>
        <a
          className={`side-nav-item${route.screen === "home" ? " side-nav-item-active" : ""}`}
          href="/"
          onClick={onHomeLinkClick}
        >
          ホーム
        </a>
      </nav>
      <main className="main-column">
        <div hidden={route.screen !== "home"}>
          <Timeline onOpenThread={openThread} />
        </div>
        {route.screen === "thread" && (
          <Thread agent={route.agent} sessionId={route.sessionId} onBack={backToTimeline} />
        )}
      </main>
    </div>
  );
}
