import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { Post, PostSession } from "./post.js";
import { logRootsFromEnv, type TimelinePage } from "./timeline.js";

// vitest.config.ts が、ログのルートの環境変数を fixtures/ の合成セッションに向けている。
const app = createApp(logRootsFromEnv(process.env));

const claudeCart = "3f2a9c1e-5b7d-4e8a-9c6f-1a2b3c4d5e6f";
const claudeReadme = "8d4e2f6a-1c3b-4a5d-8e7f-9a0b1c2d3e4f";
const codexUnit = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const codexTax = "0199b2c3-d4e5-7f6a-9b0c-1d2e3f4a5b6c";

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

/** 一覧の API を limit=5 で呼び、1 ページを返す。cursor が null なら最初のページを返す。 */
async function requestTimelinePage(cursor: string | null): Promise<TimelinePage> {
  const query = new URLSearchParams({ limit: "5" });
  if (cursor !== null) {
    query.set("cursor", cursor);
  }
  const response = await app.request(`/api/posts?${query}`);
  expect(response.status).toBe(200);
  return responseJson<TimelinePage>(response);
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
      projectDirectory: "/home/dev/acme-shop",
      gitBranch: "fix/tax-rounding",
    });
    // session_meta の git にブランチが無いセッションは null のまま返す。
    expect(sessionOf(body.posts, codexUnit)?.gitBranch).toBeNull();
  });

  it("limit と cursor で続きを取ると、全件を抜けも重なりもなく返す", async () => {
    const pages: TimelinePage[] = [];
    let cursor: string | null = null;
    do {
      const page: TimelinePage = await requestTimelinePage(cursor);
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(pages.map((page) => page.posts.length)).toEqual([5, 5, 3]);
    expect(pages.flatMap((page) => page.posts).map(postSummary)).toEqual(allPostsNewestFirst);
  });

  it("不正な limit と cursor は 400 を返す", async () => {
    expect((await app.request("/api/posts?limit=0")).status).toBe(400);
    expect((await app.request("/api/posts?limit=201")).status).toBe(400);
    expect((await app.request("/api/posts?limit=abc")).status).toBe(400);
    expect((await app.request("/api/posts?cursor=not-a-cursor")).status).toBe(400);
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
