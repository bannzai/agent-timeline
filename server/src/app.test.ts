import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { Post, PostSession, TimelinePage } from "./post.js";
import type { Project } from "./project.js";
import { logRootsFromEnv } from "./timeline.js";
import { replyCommandsFromEnv } from "./tmux.js";

// 一覧とスレッドの API は利用記録を書かないが、実際のホームディレクトリを渡さないため、一時ディレクトリにする。
const usageLogDirectory = path.join(os.tmpdir(), "agent-timeline-app-test");
// vitest.config.ts が、ログのルートの環境変数を fixtures/ の合成セッションに、tmux と ps を偽のコマンドに向けている。
const app = createApp({
  logRoots: logRootsFromEnv(process.env),
  usageLogDirectory,
  replyCommands: replyCommandsFromEnv(process.env),
});

const claudeCart = "3f2a9c1e-5b7d-4e8a-9c6f-1a2b3c4d5e6f";
const claudeReadme = "8d4e2f6a-1c3b-4a5d-8e7f-9a0b1c2d3e4f";
const codexUnit = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const codexTax = "0199b2c3-d4e5-7f6a-9b0c-1d2e3f4a5b6c";

/** fixtures/ の codexUnit のセッションにある、画面で省略される長さの agent の返答。 */
const codexUnitPlanText = [
  "切り替えを入れる前に今の作りを確認しました",
  "",
  "- 気温は天気の API から摂氏で受け取り、Forecast の表示でそのまま出しています",
  "- 設定ファイルには単位の項目がありません",
  "- テストは摂氏の表示だけを確認しています",
  "",
  "方針として --unit オプションを足し、c か f を受け取ります。既定は c にして、今の表示を変えません。華氏は表示の直前に 9/5 を掛けて 32 を足す変換で出し、API から受け取る値と設定ファイルの形は変えません。",
  "",
  "テストには、華氏の表示と、知らない単位を渡した時のエラーの 2 つを足します。README の使い方の節にもオプションの説明を 1 行足します。続けて実装します",
].join("\n");

/** fixtures/ の全セッションの投稿を新しい順に並べたもの。agent をまたいで日時が交互になる。 */
const allPostsNewestFirst = [
  ["claude-code", claudeReadme, "agent", "README に npm start の手順を足しました"],
  ["claude-code", claudeReadme, "tool", 'Bash {"command":"cat package.json"}'],
  ["claude-code", claudeReadme, "human", "README に起動方法を書いて"],
  ["codex", codexTax, "agent", "Math.floor で切り捨てるように直しました"],
  ["codex", codexTax, "tool", 'shell {"command":["rg","tax"]}'],
  ["codex", codexTax, "human", "消費税の端数を切り捨てにして"],
  ["claude-code", claudeCart, "agent", "addItem のあとに合計を計算し直すようにしました"],
  ["claude-code", claudeCart, "tool", 'Read {"file_path":"/home/dev/acme-shop/src/cart.ts"}'],
  ["claude-code", claudeCart, "agent", "合計の計算を確認します"],
  ["claude-code", claudeCart, "human", "カートに商品を追加しても合計金額が更新されないので直して"],
  ["codex", codexUnit, "agent", "--unit オプションを追加しました"],
  ["codex", codexUnit, "tool", "apply_patch *** Begin Patch\n*** End Patch"],
  ["codex", codexUnit, "agent", codexUnitPlanText],
  // < で始まる人間の指示は、Codex が差し込む文脈と違って残る。
  ["codex", codexUnit, "human", "<Forecast> の気温を摂氏と華氏で切り替えるオプションを足して"],
];

/** 投稿を、並びの比較に使う [agent, セッション ID, 書き手, 本文] にする。 */
function postSummary(post: Post): string[] {
  return [post.session.agent, post.session.sessionId, post.author, post.text];
}

/** allPostsNewestFirst のうち、指定したセッションの投稿を古い順に並べたもの。 */
function threadSummaries(sessionId: string): string[][] {
  return allPostsNewestFirst.filter(([, postSessionId]) => postSessionId === sessionId).reverse();
}

/** 投稿の列から、指定したセッションの投稿が持つセッションの情報を取る。 */
function sessionOf(posts: Post[], sessionId: string): PostSession | undefined {
  return posts.find((post) => post.session.sessionId === sessionId)?.session;
}

/** API の応答の本文を読む。 */
async function responseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/**
 * 一覧の API を呼び、1 ページを返す。cursor が null なら最初のページを返す。
 * filters は一緒に渡すクエリで、件数の上限 (limit) と絞り込みの条件 (project・worktree) を指定する。
 */
async function requestTimelinePage(
  cursor: string | null,
  filters: Record<string, string>,
): Promise<TimelinePage> {
  const query = new URLSearchParams(filters);
  if (cursor !== null) {
    query.set("cursor", cursor);
  }
  const response = await app.request(`/api/posts?${query}`);
  expect(response.status).toBe(200);
  return responseJson<TimelinePage>(response);
}

/** 一覧の API の続きを最後まで取り、全ページを返す。 */
async function requestAllTimelinePages(filters: Record<string, string>): Promise<TimelinePage[]> {
  const pages: TimelinePage[] = [];
  let cursor: string | null = null;
  do {
    const page: TimelinePage = await requestTimelinePage(cursor, filters);
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return pages;
}

/** allPostsNewestFirst のうち、指定したセッションの投稿を新しい順のまま残したもの。 */
function sessionsSummaries(sessionIds: string[]): string[][] {
  return allPostsNewestFirst.filter(([, postSessionId]) =>
    sessionIds.includes(postSessionId ?? ""),
  );
}

describe("GET /api/health", () => {
  it("ok を返す", async () => {
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("Host の検査", () => {
  it("Host がこのマシンのリクエストに答える", async () => {
    expect((await app.request("http://127.0.0.1:7878/api/posts")).status).toBe(200);
    expect((await app.request("http://localhost:5173/api/posts")).status).toBe(200);
  });

  it("Host が別のマシンのリクエストは 403 を返す", async () => {
    expect((await app.request("http://attacker.example/api/posts")).status).toBe(403);
    expect((await app.request("http://attacker.example:7878/api/health")).status).toBe(403);
    // ログの変化の知らせも会話の有無を漏らすため、知らせを始める前に拒否する。
    expect((await app.request("http://attacker.example/api/events")).status).toBe(403);
  });
});

describe("GET /api/posts", () => {
  it("Claude Code と Codex の投稿を日時の新しい順に返す", async () => {
    const response = await app.request("/api/posts");

    expect(response.status).toBe(200);
    const body = await responseJson<TimelinePage>(response);
    expect(body.posts.map(postSummary)).toEqual(allPostsNewestFirst);
    expect(body.nextCursor).toBeNull();
    const timestamps = body.posts.map((post) => post.timestamp);
    expect(timestamps).toEqual([...timestamps].sort().reverse());
  });

  it("壊れた行・知らない種類の行を読み飛ばし、同じファイルの読めた行の投稿を返す", async () => {
    const response = await app.request("/api/posts");

    expect(response.status).toBe(200);
    // 2 つのファイルは、JSON でない行・途中で切れた行・知らない type の行・content の型が違う行を含む。
    const { posts } = await responseJson<TimelinePage>(response);
    expect(posts.filter((post) => post.session.sessionId === claudeCart)).toHaveLength(4);
    expect(posts.filter((post) => post.session.sessionId === codexTax)).toHaveLength(3);
  });

  it("Claude Code が user の行に書いた通知・コマンドの出力・会話の要約は投稿にしない", async () => {
    const { posts } = await responseJson<TimelinePage>(await app.request("/api/posts"));

    // fixture のこのセッションは、3 つの投稿より新しい日時に 3 つの行を持つ。
    expect(posts.filter((post) => post.session.sessionId === claudeReadme)).toHaveLength(3);
  });

  it("投稿がどのセッションのものかを返す", async () => {
    const body = await responseJson<TimelinePage>(await app.request("/api/posts"));

    expect(sessionOf(body.posts, claudeCart)).toEqual({
      agent: "claude-code",
      sessionId: claudeCart,
      projectDirectory: "/home/dev/acme-shop",
      gitBranch: "feature/cart-total",
    });
    expect(sessionOf(body.posts, codexTax)).toEqual({
      agent: "codex",
      sessionId: codexTax,
      projectDirectory: "/home/dev/worktrees/dev/acme-shop/fix-tax-rounding",
      gitBranch: "fix/tax-rounding",
    });
    // session_meta の git にブランチが無いセッションは null のまま返す。
    expect(sessionOf(body.posts, codexUnit)?.gitBranch).toBeNull();
  });

  it("ツール呼び出しの投稿に、同じ呼び出しの結果を入れる", async () => {
    const { posts } = await responseJson<TimelinePage>(await app.request("/api/posts"));

    // 結果は、Claude Code では文字列の content、Codex では文字列の output と text を持つ要素の配列の output で書かれる。
    expect(
      posts.filter((post) => post.author === "tool").map((post) => [post.text, post.toolResult]),
    ).toEqual([
      ['Bash {"command":"cat package.json"}', '{"scripts":{"start":"node index.js"}}'],
      ['shell {"command":["rg","tax"]}', "src/tax.ts"],
      ['Read {"file_path":"/home/dev/acme-shop/src/cart.ts"}', "export function addItem() {}"],
      ["apply_patch *** Begin Patch\n*** End Patch", "Success"],
    ]);
    expect(posts.filter((post) => post.author !== "tool" && post.toolResult !== null)).toEqual([]);
  });

  it("limit と cursor で続きを取ると、全件を抜けも重なりもなく返す", async () => {
    const pages = await requestAllTimelinePages({ limit: "5" });

    expect(pages.map((page) => page.posts.length)).toEqual([5, 5, 4]);
    expect(pages.flatMap((page) => page.posts).map(postSummary)).toEqual(allPostsNewestFirst);
  });

  it("ログのルートが空のディレクトリの時は、空の一覧を返す", async () => {
    // fixtures/empty は、ログのファイルを持たないディレクトリ (git に残すための .gitkeep だけを持つ)。
    const response = await createApp({
      logRoots: {
        claudeCodeProjectsDirectory: "fixtures/empty",
        codexSessionsDirectory: "fixtures/empty",
      },
      usageLogDirectory,
      replyCommands: replyCommandsFromEnv(process.env),
    }).request("/api/posts");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ posts: [], nextCursor: null });
  });

  it("不正な limit と cursor は 400 を返す", async () => {
    expect((await app.request("/api/posts?limit=0")).status).toBe(400);
    expect((await app.request("/api/posts?limit=201")).status).toBe(400);
    expect((await app.request("/api/posts?limit=abc")).status).toBe(400);
    expect((await app.request("/api/posts?cursor=not-a-cursor")).status).toBe(400);
  });
});

describe("GET /api/posts の絞り込み", () => {
  // fixture の acme-shop のプロジェクトは、本体の checkout (/home/dev/acme-shop) の claudeCart と、
  // worktree (/home/dev/worktrees/dev/acme-shop/fix-tax-rounding) の codexTax の 2 つのセッションを持つ。
  it("project でそのプロジェクトの全 worktree のセッションの投稿だけを新しい順に返す", async () => {
    const page = await requestTimelinePage(null, { project: "acme-shop" });

    expect(page.posts.map(postSummary)).toEqual(sessionsSummaries([claudeCart, codexTax]));
    expect(page.nextCursor).toBeNull();
  });

  it.each([
    ["fix-tax-rounding", [codexTax]],
    ["acme-shop", [claudeCart]],
  ])(
    "worktree に %s を足すとその worktree のセッションの投稿だけを返す",
    async (worktree, sessionIds) => {
      const page = await requestTimelinePage(null, { project: "acme-shop", worktree });

      expect(page.posts.map(postSummary)).toEqual(sessionsSummaries(sessionIds));
    },
  );

  it("絞った一覧も limit と cursor で続きを取ると、抜けも重なりもなく返す", async () => {
    const pages = await requestAllTimelinePages({ project: "acme-shop", limit: "2" });

    expect(pages.map((page) => page.posts.length)).toEqual([2, 2, 2, 1]);
    expect(pages.flatMap((page) => page.posts).map(postSummary)).toEqual(
      sessionsSummaries([claudeCart, codexTax]),
    );
  });

  it("ログが無いプロジェクトと worktree は空の一覧を返す", async () => {
    expect(await requestTimelinePage(null, { project: "no-such-project" })).toEqual({
      posts: [],
      nextCursor: null,
    });
    expect(
      await requestTimelinePage(null, { project: "acme-shop", worktree: "no-such-worktree" }),
    ).toEqual({ posts: [], nextCursor: null });
  });

  it("project の無い worktree は 400 を返す", async () => {
    expect((await app.request("/api/posts?worktree=fix-tax-rounding")).status).toBe(400);
  });
});

describe("GET /api/projects", () => {
  it("ログがあるプロジェクトと、本体の checkout と worktree をまとめた worktree の一覧を返す", async () => {
    const response = await app.request("/api/projects");

    expect(response.status).toBe(200);
    const { projects } = await responseJson<{ projects: Project[] }>(response);
    // 並びはログのファイルの最終更新で決まり、fixture を checkout した時刻による。並びは timeline.test.ts で確かめる。
    expect(
      projects
        .map((project) => ({
          ...project,
          worktrees: project.worktrees.sort((a, b) => a.worktreeName.localeCompare(b.worktreeName)),
        }))
        .sort((a, b) => a.projectName.localeCompare(b.projectName)),
    ).toEqual([
      {
        projectName: "acme-shop",
        worktrees: [
          {
            worktreeName: "acme-shop",
            directory: "/home/dev/acme-shop",
            gitBranch: "feature/cart-total",
            lastActiveAt: expect.any(String),
          },
          {
            worktreeName: "fix-tax-rounding",
            directory: "/home/dev/worktrees/dev/acme-shop/fix-tax-rounding",
            gitBranch: "fix/tax-rounding",
            lastActiveAt: expect.any(String),
          },
        ],
      },
      {
        projectName: "notes-app",
        worktrees: [
          {
            worktreeName: "notes-app",
            directory: "/home/dev/notes-app",
            gitBranch: "main",
            lastActiveAt: expect.any(String),
          },
        ],
      },
      {
        projectName: "weather-cli",
        worktrees: [
          {
            worktreeName: "weather-cli",
            directory: "/home/dev/weather-cli",
            gitBranch: null,
            lastActiveAt: expect.any(String),
          },
        ],
      },
    ]);
  });
});

describe("GET /api/events", () => {
  it("Server-Sent Events でつなぎ、見張りの基準ができると ready を送る", async () => {
    const response = await app.request("/api/events");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const firstChunk = await reader?.read();
    expect(new TextDecoder().decode(firstChunk?.value)).toBe("event: ready\ndata: {}\n\n");
    // ブラウザが閉じた時と同じく読むのをやめ、見張りの購読をやめさせる。
    await reader?.cancel();
  });
});

describe("GET /api/sessions/:agent/:sessionId/posts", () => {
  it("Claude Code のセッションの発言だけを古い順に返す", async () => {
    const response = await app.request(`/api/sessions/claude-code/${claudeCart}/posts`);

    expect(response.status).toBe(200);
    const body = await responseJson<{ posts: Post[] }>(response);
    expect(body.posts.map(postSummary)).toEqual(threadSummaries(claudeCart));
  });

  it("Codex のセッションの発言だけを古い順に返す", async () => {
    const response = await app.request(`/api/sessions/codex/${codexUnit}/posts`);

    expect(response.status).toBe(200);
    const body = await responseJson<{ posts: Post[] }>(response);
    expect(body.posts.map(postSummary)).toEqual(threadSummaries(codexUnit));
  });

  it.each([
    "/api/sessions/claude-code/00000000-0000-0000-0000-000000000000/posts",
    `/api/sessions/codex/${claudeCart}/posts`,
    `/api/sessions/gemini/${claudeCart}/posts`,
    "/api/sessions/claude-code/..%2F..%2Fetc%2Fpasswd/posts",
  ])("無いセッション・知らない agent の %s は 404 を返す", async (requestPath) => {
    expect((await app.request(requestPath)).status).toBe(404);
  });
});
