import { expect, type Locator, type Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Post } from "../../server/src/post.js";
import { fakeTmuxCallsFile } from "../fake-commands.js";
import { enableShowToolCalls } from "../show-tool-calls.js";

/**
 * fixture の Claude Code のセッションのうち、ツール呼び出しとその結果を持つもの。
 * 偽の tmux には、このセッションの作業ディレクトリで Claude Code が動いている pane (`%1`) がある (fixtures/fake-commands/README.md)。
 */
const claudeCart = "3f2a9c1e-5b7d-4e8a-9c6f-1a2b3c4d5e6f";
const claudeCartThreadPath = `/sessions/claude-code/${claudeCart}`;
/** 偽の tmux に、作業ディレクトリでエージェントが動いている pane が無いセッション。 */
const claudeReadmeThreadPath = "/sessions/claude-code/8d4e2f6a-1c3b-4a5d-8e7f-9a0b1c2d3e4f";
/** 偽の tmux に、作業ディレクトリで Codex が動いている pane が 2 つあるセッション。 */
const codexUnitThreadPath = "/sessions/codex/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
/** claudeCart のセッションの agent の返答。タイムラインでこの投稿を押してスレッドへ移る。 */
const claudeCartReplyText = "合計の計算を確認します";

// 相対時刻をスクリーンショットごとに同じにするため、fixture の最も新しい投稿 (2026-10-02T10:30:10Z) の少し後で時計を止める。
const fixedNow = new Date("2026-10-02T10:31:00.000Z");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(fixedNow);
  // ここのテストはツール呼び出しを含む発言の並びと、ツール呼び出しを開く表示を確かめる。既定の表示 (ツール呼び出しを
  // 出さない) は tool-calls-toggle.spec.ts が確かめる。
  await enableShowToolCalls(page);
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

test("タイムラインの投稿からスレッドへ移り、そのセッションの最新と最初の発言を出して間を畳む", async ({
  page,
}, testInfo) => {
  const response = await page.request.get(`/api${claudeCartThreadPath}/posts`);
  expect(response.status()).toBe(200);
  const { posts } = (await response.json()) as { posts: Post[] };
  expect(posts).toHaveLength(4);

  await openClaudeCartThreadFromTimeline(page);

  const threadPosts = page.getByTestId("thread-post");
  await expect(threadPosts).toHaveCount(2);
  expect(await attributeValues(threadPosts, "data-post-id")).toEqual([posts[3]?.id, posts[0]?.id]);
  const foldButton = page.getByRole("button", { name: "他 2 件" });
  await expect(foldButton).toBeVisible();
  expect(new Set(await attributeValues(threadPosts, "data-session-id"))).toEqual(
    new Set([claudeCart]),
  );
  // スレッドを開いている間、タイムラインの投稿は見えない。
  await expect(page.getByTestId("post").first()).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("thread.png"), fullPage: true });

  // 「他 2 件」を押すと間の発言が開き、全部の発言が新しい順に並ぶ。
  await foldButton.click();
  await expect(threadPosts).toHaveCount(posts.length);
  expect(await attributeValues(threadPosts, "data-post-id")).toEqual(
    posts.map((post) => post.id).reverse(),
  );
  const timestamps = await attributeValues(threadPosts.locator("time"), "datetime");
  expect(timestamps).toEqual([...timestamps].sort().reverse());
  await expect(page.getByTestId("thread-fold")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("thread-expanded.png"), fullPage: true });

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
  // 位置は、タイムラインの表示が変わって高さが変わっても届くよう、スクロールできる範囲の中ほどにする。
  const readingScrollY = await page.evaluate(() =>
    Math.floor((document.documentElement.scrollHeight - window.innerHeight) / 2),
  );
  expect(readingScrollY).toBeGreaterThan(0);
  await page.evaluate((scrollY) => window.scrollTo(0, scrollY), readingScrollY);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(readingScrollY);
  await page.goForward();
  await expect(page).toHaveURL(claudeCartThreadPath);
  await expect(page.getByTestId("thread-post").first()).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(readingScrollY);
});

test("ツール呼び出しを開くと入力と結果の要約を表示する", async ({ page }, testInfo) => {
  await page.goto(claudeCartThreadPath);
  // このセッションのツール呼び出しは、最初と最新の発言の間にあり畳まれているため、開いてから押す。
  await page.getByRole("button", { name: "他 2 件" }).click();

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

test("返信できるセッションでは、返信欄から送ると届いた表示になり、本文がその pane へ送られる", async ({
  page,
}, testInfo) => {
  const replyText = "合計のテストも足して";
  await page.goto(claudeCartThreadPath);

  const replyForm = page.getByTestId("reply-form");
  const replyInput = replyForm.getByRole("textbox", { name: "返信" });
  await replyInput.fill(replyText);
  await replyForm.getByRole("button", { name: "返信", exact: true }).click();

  const replyStatus = page.getByTestId("reply-status");
  await expect(replyStatus).toHaveAttribute("data-status", "sent");
  await expect(replyStatus).toHaveText("届きました");
  await expect(replyInput).toHaveValue("");
  await page.screenshot({ path: testInfo.outputPath("thread-reply-sent.png"), fullPage: true });

  const sendKeysCalls = (await readFile(fakeTmuxCallsFile, "utf8"))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as string[])
    .filter((args) => args[0] === "send-keys");
  expect(sendKeysCalls.slice(-2)).toEqual([
    ["send-keys", "-t", "%1", "-l", "--", replyText],
    ["send-keys", "-t", "%1", "Enter"],
  ]);
});

test("返信できないセッションでは、返信欄を出さず理由を表示する", async ({ page }, testInfo) => {
  await page.goto(claudeReadmeThreadPath);
  await expect(page.getByTestId("thread-post").first()).toBeVisible();
  await expect(page.getByTestId("reply-unavailable")).toHaveText(
    "このセッションが動いている tmux の pane が見つかりません",
  );
  await expect(page.getByTestId("reply-form")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("thread-reply-unavailable.png"),
    fullPage: true,
  });

  await page.goto(codexUnitThreadPath);
  await expect(page.getByTestId("thread-post").first()).toBeVisible();
  await expect(page.getByTestId("reply-unavailable")).toHaveText(
    "同じディレクトリで同じ種類のエージェントが複数動いているため送り先を決められません",
  );
  await expect(page.getByTestId("reply-form")).toHaveCount(0);
});
