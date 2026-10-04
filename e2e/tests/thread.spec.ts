import { expect, type Locator, type Page, test } from "@playwright/test";
import type { Post } from "../../server/src/post.js";

/** fixture の Claude Code のセッションのうち、ツール呼び出しとその結果を持つもの。 */
const claudeCart = "3f2a9c1e-5b7d-4e8a-9c6f-1a2b3c4d5e6f";
const claudeCartThreadPath = `/sessions/claude-code/${claudeCart}`;
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

/** スレッドの読み込みを待ち、並んだ投稿の文を上から順に返す。 */
async function renderedThreadTexts(page: Page): Promise<string[]> {
  await expect(page.getByTestId("thread-post").first()).toBeVisible();
  return page.getByTestId("thread-post").allInnerTexts();
}

/** タイムラインを開き、claudeCart の投稿を押してスレッドへ移る。 */
async function openClaudeCartThreadFromTimeline(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("post").filter({ hasText: claudeCartReplyText }).click();
  await expect(page).toHaveURL(claudeCartThreadPath);
}

test("タイムラインの投稿からスレッドへ移り、そのセッションの発言だけを古い順に表示する", async ({
  page,
}, testInfo) => {
  const response = await page.request.get(`/api${claudeCartThreadPath}/posts`);
  expect(response.status()).toBe(200);
  const { posts } = (await response.json()) as { posts: Post[] };

  await openClaudeCartThreadFromTimeline(page);

  const threadPosts = page.getByTestId("thread-post");
  await expect(threadPosts).toHaveCount(posts.length);
  expect(await attributeValues(threadPosts, "data-post-id")).toEqual(posts.map((post) => post.id));
  expect(new Set(await attributeValues(threadPosts, "data-session-id"))).toEqual(
    new Set([claudeCart]),
  );
  const timestamps = await attributeValues(threadPosts.locator("time"), "datetime");
  expect(timestamps).toEqual([...timestamps].sort());
  // スレッドを開いている間、タイムラインの投稿は見えない。
  await expect(page.getByTestId("post").first()).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("thread.png"), fullPage: true });

  await page.getByRole("button", { name: "戻る" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("post").filter({ hasText: claudeCartReplyText })).toBeVisible();
  await expect(threadPosts).toHaveCount(0);
});

test("スレッドの URL を直接開いても同じ表示になる", async ({ page }) => {
  await openClaudeCartThreadFromTimeline(page);
  const textsFromTimeline = await renderedThreadTexts(page);

  await page.goto(claudeCartThreadPath);
  expect(await renderedThreadTexts(page)).toEqual(textsFromTimeline);

  // 直接開いた時も、戻るでタイムラインへ移る。
  await page.getByRole("button", { name: "戻る" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("post").first()).toBeVisible();
});

test("ブラウザの進むでスレッドへ移った後に戻っても、タイムラインの読んでいた位置に戻る", async ({
  page,
}) => {
  await openClaudeCartThreadFromTimeline(page);
  await page.goBack();
  await expect(page).toHaveURL("/");
  // スレッドを開いた時と違う位置まで読み進めてから、ブラウザの進むでスレッドへ移る。
  // 200px は、fixture の 14 件のタイムラインがこの画面の高さで届く位置。
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200);
  await page.goForward();
  await expect(page).toHaveURL(claudeCartThreadPath);
  await expect(page.getByTestId("thread-post").first()).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200);
});

test("ツール呼び出しを開くと入力と結果の要約を表示する", async ({ page }, testInfo) => {
  await page.goto(claudeCartThreadPath);

  const toolCall = page.getByTestId("tool-call");
  await expect(toolCall).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("tool-detail")).toHaveCount(0);

  await toolCall.click();
  await expect(toolCall).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("tool-input")).toHaveText(
    'Read {"file_path":"/home/dev/acme-shop/src/cart.ts"}',
  );
  await expect(page.getByTestId("tool-result")).toHaveText("export function addItem() {}");
  await page.screenshot({ path: testInfo.outputPath("thread-tool-expanded.png"), fullPage: true });
});
