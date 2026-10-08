import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PostSession } from "../../server/src/post.js";
import { ProjectPage, ProjectRow, WorktreePage } from "./Projects";
import { handleInAppLinkClick, type Route, routeFromPath, routePath } from "./route";
import {
  readShowToolCalls,
  ShowToolCallsContext,
  useShowToolCallsSetting,
  writeShowToolCalls,
} from "./show-tool-calls";
import { Thread } from "./Thread";
import { Timeline } from "./Timeline";

/** スレッドを除いた画面の場所。投稿を並べる画面で、スレッドを開いている間も隠して残す。 */
type ListRoute = Exclude<Route, { screen: "thread" }>;

/** アプリの中で画面を移った時に履歴へ入れる印。戻るボタンが、ブラウザの戻ると同じく元の画面へ戻れるかを知るために使う。 */
interface InAppHistoryState {
  /** アプリの中の画面から移ってきたこと。履歴の 1 つ前がこのアプリの画面であることを表す。 */
  openedInApp: true;
}

/** 履歴の state が、アプリの中で画面を移った時に入れたものか。 */
function isOpenedInApp(state: unknown): state is InAppHistoryState {
  return typeof state === "object" && state !== null && "openedInApp" in state;
}

/**
 * 画面のルート。URL のパスからタイムライン・プロジェクトのページ・worktree のページ・スレッドを切り替える。
 * スレッドを開いている間も元の画面を隠して残し、戻った時に読み込んだ投稿と読んでいた位置をそのまま出す。
 */
export function App() {
  const [route, setRoute] = useState<Route>(() => routeFromPath(window.location.pathname));
  // スレッドの下に隠して残す画面。スレッドの URL を直接開いた時はタイムライン。
  const [listRoute, setListRoute] = useState<ListRoute>(() =>
    route.screen === "thread" ? { screen: "home" } : route,
  );
  // 画面の URL のパスごとの、その画面から離れた時のスクロールの位置。
  const scrollYByListPathRef = useRef(new Map<string, number>());
  // いま出している画面。ブラウザの戻る・進むの通知で、離れる画面を知るために使う。
  const currentRouteRef = useRef(route);
  // ツール呼び出しを表示するか。既定は出さず、変えた値はブラウザに保存して次に開いた時も保つ。
  const [showToolCalls, setShowToolCalls] = useState(readShowToolCalls);

  /** ツール呼び出しの表示を切り替え、ブラウザに保存する。 */
  const changeShowToolCalls = (nextShowToolCalls: boolean) => {
    setShowToolCalls(nextShowToolCalls);
    writeShowToolCalls(nextShowToolCalls);
  };

  /** 画面の場所を替える。スレッドでない画面は、スレッドを開いた時に隠して残す画面にもする。 */
  const showRoute = (nextRoute: Route) => {
    setRoute(nextRoute);
    if (nextRoute.screen !== "thread") {
      setListRoute(nextRoute);
    }
  };

  /** 離れる画面が投稿を並べる画面なら、読んでいた位置を残す。 */
  const rememberListScrollY = (leavingRoute: Route) => {
    if (leavingRoute.screen !== "thread") {
      scrollYByListPathRef.current.set(routePath(leavingRoute), window.scrollY);
    }
  };

  useEffect(() => {
    // 戻った時のスクロールの位置は、隠して残した画面に合わせてこの画面が戻す。
    window.history.scrollRestoration = "manual";
    // 画面の場所として読めない URL (`/sessions/gemini/abc` など) はタイムラインを出すため、URL もタイムラインの `/` に直す。
    if (
      routeFromPath(window.location.pathname).screen === "home" &&
      window.location.pathname !== "/"
    ) {
      window.history.replaceState(null, "", "/");
    }
    /**
     * ブラウザの戻る・進むで変わった URL を、画面の場所に写す。投稿を並べる画面から離れる時は、読んでいた位置を残す
     * (scrollRestoration が manual のため、通知の時点のスクロールの位置はまだ離れる画面のもの)。
     */
    const onPopState = () => {
      rememberListScrollY(currentRouteRef.current);
      showRoute(routeFromPath(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useLayoutEffect(() => {
    currentRouteRef.current = route;
    window.scrollTo(
      0,
      route.screen === "thread" ? 0 : (scrollYByListPathRef.current.get(routePath(route)) ?? 0),
    );
  }, [route]);

  /** 画面を移り、履歴に積む。ブラウザの戻るで元の画面へ戻れる。 */
  const navigate = (nextRoute: Route) => {
    rememberListScrollY(route);
    window.history.pushState(
      { openedInApp: true } satisfies InAppHistoryState,
      "",
      routePath(nextRoute),
    );
    showRoute(nextRoute);
  };

  /**
   * 1 つ前の画面へ戻る。アプリの中の画面から移ってきた時は、ブラウザの戻ると同じく履歴を戻る。
   * URL を直接開いた時は、履歴の前がこのアプリではないため、同じ履歴の位置で parentRoute に替える。
   */
  const goBack = (parentRoute: Route) => {
    if (isOpenedInApp(window.history.state)) {
      window.history.back();
      return;
    }
    window.history.replaceState(null, "", routePath(parentRoute));
    showRoute(parentRoute);
  };

  /** セッションのスレッドへ移る。 */
  const openThread = (session: PostSession) => {
    navigate({ screen: "thread", agent: session.agent, sessionId: session.sessionId });
  };

  /** メニューのホームへのリンクを押した時の処理。ページを読み直さず、タイムラインへ移る。 */
  const onHomeLinkClick = (event: MouseEvent<HTMLAnchorElement>) => {
    handleInAppLinkClick(event, () => {
      if (route.screen !== "home") {
        navigate({ screen: "home" });
      }
    });
  };

  return (
    <ShowToolCallsContext.Provider value={{ showToolCalls, setShowToolCalls: changeShowToolCalls }}>
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
          <ShowToolCallsSwitch className="side-nav-toggle" />
        </nav>
        <main className="main-column">
          {/* 投稿を並べる画面は、ツール呼び出しの表示を替えると一覧の API の条件が変わるため、作り直して最初から読む。 */}
          <div hidden={route.screen === "thread"}>
            <ListScreen
              key={`${routePath(listRoute)}:${String(showToolCalls)}`}
              listRoute={listRoute}
              onNavigate={navigate}
              onBack={goBack}
              onOpenThread={openThread}
            />
          </div>
          {route.screen === "thread" && (
            <Thread
              agent={route.agent}
              sessionId={route.sessionId}
              onBack={() => goBack(listRoute)}
            />
          )}
        </main>
      </div>
    </ShowToolCallsContext.Provider>
  );
}

/**
 * 「ツール呼び出しを表示」のスイッチ。メニューに置き、メニューが隠れる狭い画面ではホームの見出しにも置く
 * (className で置き場所の見た目を替える)。
 */
function ShowToolCallsSwitch({ className }: { className: string }) {
  const { showToolCalls, setShowToolCalls } = useShowToolCallsSetting();
  return (
    <label className={className}>
      <input
        type="checkbox"
        role="switch"
        className="toggle-switch"
        checked={showToolCalls}
        onChange={(event) => setShowToolCalls(event.target.checked)}
      />
      <span>ツール呼び出しを表示</span>
    </label>
  );
}

/** 投稿を並べる画面。タイムライン・プロジェクトのページ・worktree のページのどれかを出す。 */
function ListScreen({
  listRoute,
  onNavigate,
  onBack,
  onOpenThread,
}: {
  listRoute: ListRoute;
  onNavigate: (nextRoute: Route) => void;
  onBack: (parentRoute: Route) => void;
  onOpenThread: (session: PostSession) => void;
}) {
  switch (listRoute.screen) {
    case "home":
      return (
        <>
          <header className="column-header">
            <h1 className="column-title">ホーム</h1>
            <ShowToolCallsSwitch className="column-header-toggle" />
          </header>
          <ProjectRow
            onOpenProject={(projectName) => onNavigate({ screen: "project", projectName })}
          />
          <Timeline filter={null} onOpenThread={onOpenThread} />
        </>
      );
    case "project":
      return (
        <ProjectPage
          projectName={listRoute.projectName}
          onBack={() => onBack({ screen: "home" })}
          onOpenWorktree={(worktreeName) =>
            onNavigate({ screen: "worktree", projectName: listRoute.projectName, worktreeName })
          }
          onOpenThread={onOpenThread}
        />
      );
    case "worktree":
      return (
        <WorktreePage
          projectName={listRoute.projectName}
          worktreeName={listRoute.worktreeName}
          onBack={() => onBack({ screen: "project", projectName: listRoute.projectName })}
          onOpenThread={onOpenThread}
        />
      );
  }
}
