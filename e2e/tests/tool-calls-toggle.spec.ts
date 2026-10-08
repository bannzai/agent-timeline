import { expect, type Locator, type Page, test } from "@playwright/test";
import type { Post, TimelinePage } from "../../server/src/post.js";
import { conversationAuthors } from "../../web/src/show-tool-calls.js";

/** fixture の Claude Code のセッションのうち、人間の指示・agent の返答 2 件・ツール呼び出し 1 件を持つもの。 */
const claudeCartThreadPath = "/sessions/claude-code/3f2a9c1e-5b7d-4e8a-9c6f-1a2b3c4d5e6f";
/** claudeCart のセッションの agent の返答。タイムラインでこの投稿を押してスレッドへ移る。 */
const claudeCartReplyText = "合計の計算を確認します";

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

/** 一覧の API が query の条件で 1 ページで返す全投稿。fixture の投稿は API の既定の件数に収まる。 */
async function requestPosts(page: Page, query: Record<string, string>): Promise<Post[]> {
  const response = await page.request.get(`/api/posts?${new URLSearchParams(query)}`);
  expect(response.status()).toBe(200);
  const timeline = (await response.json()) as TimelinePage;
  expect(timeline.nextCursor).toBeNull();
  return timeline.posts;
}

/** メニューの「ツール呼び出しを表示」のスイッチ。 */
function showToolCallsSwitch(page: Page): Locator {
  return page.getByRole("switch", { name: "ツール呼び出しを表示" });
}

test("既定ではタイムラインとスレッドにツール呼び出しが出ず、一覧の API を会話の書き手に絞って呼ぶ", async ({
  page,
}, testInfo) => {
  const conversationPosts = await requestPosts(page, { authors: conversationAuthors });
  const allPosts = await requestPosts(page, {});
  // ツール呼び出しを持つ fixture であることを先に確かめ、画面で出ないことを確かめたことにする。
  expect(conversationPosts.length).toBeLessThan(allPosts.length);
  expect(conversationPosts.some((post) => post.author === "tool")).toBe(false);
  // 画面が呼ぶ一覧の API のクエリ。続きの読み込みと新着を探す読み込みも、同じ条件で呼ぶ。
  const postsRequestQueries: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/posts") {
      postsRequestQueries.push(url.search);
    }
  });
  await page.goto("/");

  await expect(showToolCallsSwitch(page)).not.toBeChecked();
  const posts = page.getByTestId("post");
  await expect(posts).toHaveCount(conversationPosts.length);
  expect(await attributeValues(posts, "data-post-id")).toEqual(
    conversationPosts.map((post) => post.id),
  );
  await expect(page.getByTestId("tool-call")).toHaveCount(0);
  await expect(page.locator('[data-author="tool"]')).toHaveCount(0);
  expect(postsRequestQueries.length).toBeGreaterThan(0);
  for (const query of postsRequestQueries) {
    expect(new URLSearchParams(query).get("authors")).toBe(conversationAuthors);
  }
  await page.screenshot({
    path: testInfo.outputPath("timeline-tool-calls-hidden.png"),
    fullPage: true,
  });

  // スレッドでも出さず、「他 x 件」もツール呼び出しを除いて数える (claudeCart は 4 件のうち 1 件がツール呼び出し)。
  await posts.filter({ hasText: claudeCartReplyText }).click();
  await expect(page).toHaveURL(claudeCartThreadPath);
  const threadPosts = page.getByTestId("thread-post");
  await expect(threadPosts).toHaveCount(2);
  const foldButton = page.getByRole("button", { name: "他 1 件" });
  await expect(foldButton).toBeVisible();
  await foldButton.click();
  await expect(threadPosts).toHaveCount(3);
  await expect(page.getByTestId("tool-call")).toHaveCount(0);
  await expect(page.locator('[data-author="tool"]')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("thread-tool-calls-hidden.png"),
    fullPage: true,
  });
});

test("スイッチを ON にするとツール呼び出しが出て、再読み込みしても設定が保たれる", async ({
  page,
}, testInfo) => {
  const allPosts = await requestPosts(page, {});
  const toolPostCount = allPosts.filter((post) => post.author === "tool").length;
  expect(toolPostCount).toBeGreaterThan(0);
  await page.goto("/");
  const posts = page.getByTestId("post");
  await expect(posts).toHaveCount(allPosts.length - toolPostCount);

  await showToolCallsSwitch(page).check();
  await expect(showToolCallsSwitch(page)).toBeChecked();
  await expect(posts).toHaveCount(allPosts.length);
  expect(await attributeValues(posts, "data-post-id")).toEqual(allPosts.map((post) => post.id));
  await expect(page.getByTestId("tool-call")).toHaveCount(toolPostCount);
  await page.screenshot({
    path: testInfo.outputPath("timeline-tool-calls-shown.png"),
    fullPage: true,
  });

  // 再読み込みしても ON のまま。
  await page.reload();
  await expect(showToolCallsSwitch(page)).toBeChecked();
  await expect(posts).toHaveCount(allPosts.length);
  await expect(page.getByTestId("tool-call")).toHaveCount(toolPostCount);

  // スレッドでも出し、「他 x 件」はツール呼び出しを含めて数える。
  await page.goto(claudeCartThreadPath);
  await expect(showToolCallsSwitch(page)).toBeChecked();
  const foldButton = page.getByRole("button", { name: "他 2 件" });
  await expect(foldButton).toBeVisible();
  await foldButton.click();
  await expect(page.getByTestId("thread-post")).toHaveCount(4);
  await expect(page.getByTestId("tool-call")).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("thread-tool-calls-shown.png"),
    fullPage: true,
  });

  // OFF に戻すとその場で消え、再読み込みしても OFF のまま。
  await showToolCallsSwitch(page).uncheck();
  await expect(page.getByTestId("tool-call")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "他 1 件" })).toBeVisible();
  await page.reload();
  await expect(showToolCallsSwitch(page)).not.toBeChecked();
  await expect(page.getByTestId("thread-post").first()).toBeVisible();
  await expect(page.getByTestId("tool-call")).toHaveCount(0);
});
