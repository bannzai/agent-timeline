import { expect, type Locator, type Page, test } from "@playwright/test";
import type { TimelinePage } from "../../server/src/post.js";
import { expectedPostGroups, renderedPostGroups } from "../post-groups.js";

// 相対時刻をスクリーンショットごとに同じにするため、fixture の最も新しい投稿 (2026-10-02T10:30:10Z) の少し後で時計を止める。
const fixedNow = new Date("2026-10-02T10:31:00.000Z");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(fixedNow);
});

/** 要素の列から、属性の値を上から順に返す。 */
async function attributeValues(elements: Locator, attributeName: string): Promise<string[]> {
  return elements.evaluateAll(
    (nodes, name) => nodes.map((node) => node.getAttribute(name) ?? ""),
    attributeName,
  );
}

/** 一覧の API が 1 ページで返す全投稿。fixture の投稿は API の既定の件数に収まる。 */
async function requestAllPosts(page: Page): Promise<TimelinePage["posts"]> {
  const response = await page.request.get("/api/posts");
  expect(response.status()).toBe(200);
  const timeline = (await response.json()) as TimelinePage;
  expect(timeline.nextCursor).toBeNull();
  return timeline.posts;
}

test("Claude Code と Codex の投稿を新しい順に表示する", async ({ page }, testInfo) => {
  const allPosts = await requestAllPosts(page);
  await page.goto("/");

  const posts = page.getByTestId("post");
  await expect(posts).toHaveCount(allPosts.length);
  expect(await attributeValues(posts, "data-post-id")).toEqual(allPosts.map((post) => post.id));
  const timestamps = await attributeValues(posts.locator("time"), "datetime");
  expect(timestamps).toEqual([...timestamps].sort().reverse());
  for (const agent of ["claude-code", "codex"]) {
    await expect(posts.and(page.locator(`[data-agent="${agent}"]`)).first()).toBeVisible();
  }
  // 人間の指示にだけ、agent の返答と見分けるための行が付く。
  const humanPostCount = allPosts.filter((post) => post.author === "human").length;
  await expect(page.getByTestId("human-context")).toHaveCount(humanPostCount);
  await expect(
    posts.and(page.locator('[data-author="human"]')).getByTestId("human-context"),
  ).toHaveCount(humanPostCount);

  await page.screenshot({ path: testInfo.outputPath("timeline.png"), fullPage: true });
});

test("同じセッションの連続する投稿を、先頭だけに投稿者を出し縦線でつないだ 1 つのまとまりにする", async ({
  page,
}) => {
  const allPosts = await requestAllPosts(page);
  await page.goto("/");

  const posts = page.getByTestId("post");
  await expect(posts).toHaveCount(allPosts.length);
  // fixture の 4 つのセッションの投稿は、日時が重ならず、セッションごとに続けて並ぶ。
  const groups = expectedPostGroups(allPosts);
  expect(groups).toHaveLength(4);
  expect(await renderedPostGroups(posts)).toEqual(groups);
  await expect(page.getByTestId("avatar")).toHaveCount(groups.length);
  // まとまりの続きでも、人間の指示の行とツール呼び出しの 1 行の表示は残る。fixture の人間の指示は、どれもセッションの
  // 最初の発言で、新しい順のまとまりの末尾 (続きの投稿) に並ぶ。
  const continuedPosts = page.locator(".timeline-post-continued");
  await expect(continuedPosts.getByTestId("tool-call")).toHaveCount(4);
  await expect(continuedPosts.getByTestId("human-context")).toHaveCount(
    allPosts.filter((post) => post.author === "human").length,
  );
});

test("長い本文を省略して開けるようにし、ツール呼び出しを 1 行に畳む", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  const longPost = page
    .getByTestId("post")
    .filter({ hasText: "切り替えを入れる前に今の作りを確認しました" });
  const showMoreButton = longPost.getByRole("button", { name: "さらに表示" });
  await expect(showMoreButton).toBeVisible();
  // fixture の本文の最後の段落は、省略した先頭に入らない。
  await expect(longPost).not.toContainText("続けて実装します");
  await longPost.screenshot({ path: testInfo.outputPath("timeline-long-post-collapsed.png") });

  await showMoreButton.click();
  await expect(longPost).toContainText("続けて実装します");
  await expect(showMoreButton).toHaveCount(0);
  // さらに表示はその場で開き、スレッドへは移らない。
  await expect(page).toHaveURL("/");
  await longPost.screenshot({ path: testInfo.outputPath("timeline-long-post-expanded.png") });

  const toolCalls = page.getByTestId("tool-call");
  await expect(toolCalls).toHaveCount(4);
  // 改行を含む引数 (apply_patch) も、ほかのツール呼び出しと同じ 1 行の高さに収まる。
  const heights = await toolCalls.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().height),
  );
  expect(new Set(heights).size).toBe(1);
  // 1 行の文字 (13px) と上下の余白 (6px ずつ) の高さで、2 行目が入る高さに届かない。
  expect(heights[0]).toBeLessThan(40);
  // ツールの結果は、スレッドでツール呼び出しを開くまで出さない。
  await expect(page.getByText("export function addItem() {}")).toHaveCount(0);
});

test("下まで読むと続きを読み込む", async ({ page }) => {
  const allPosts = await requestAllPosts(page);
  const requestedCursors: (string | null)[] = [];
  // fixture の投稿は 1 ページに収まるため、1 ページの件数を減らして続きの読み込みを起こす。
  await page.route("**/api/posts*", async (route) => {
    const url = new URL(route.request().url());
    // limit を付けた読み込みは、ページの読み込みではなく新着を探す読み込み (web/src/Timeline.tsx) のため数えない。
    if (url.searchParams.has("limit")) {
      await route.continue();
      return;
    }
    requestedCursors.push(url.searchParams.get("cursor"));
    url.searchParams.set("limit", "5");
    await route.continue({ url: url.toString() });
  });
  await page.goto("/");

  await expect(async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.getByTestId("post")).toHaveCount(allPosts.length, { timeout: 1000 });
  }).toPass();
  expect(await attributeValues(page.getByTestId("post"), "data-post-id")).toEqual(
    allPosts.map((post) => post.id),
  );
  // 14 件を 5 件ずつ読むため、最初のページと 2 回の続きを読む。
  expect(requestedCursors).toHaveLength(3);
  expect(requestedCursors[0]).toBeNull();
  // ページの境目がまとまりの途中にあっても (2 つ目のセッションの 3 件は 5 件目と 6 件目の間で分かれる)、
  // 同じセッションなら前のまとまりにつながる。
  expect(await renderedPostGroups(page.getByTestId("post"))).toEqual(expectedPostGroups(allPosts));
});
