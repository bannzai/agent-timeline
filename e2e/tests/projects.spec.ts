import { expect, type Locator, type Page, test } from "@playwright/test";
import type { TimelinePage } from "../../server/src/post.js";
import { enableShowToolCalls } from "../show-tool-calls.js";

// fixture の acme-shop のプロジェクトは、本体の checkout (/home/dev/acme-shop) の claudeCart と、
// worktree (/home/dev/worktrees/dev/acme-shop/fix-tax-rounding) の codexTax の 2 つのセッションを持つ。
const claudeCart = "3f2a9c1e-5b7d-4e8a-9c6f-1a2b3c4d5e6f";
const codexTax = "0199b2c3-d4e5-7f6a-9b0c-1d2e3f4a5b6c";
const acmeShopPath = "/projects/acme-shop";
const taxWorktreePath = "/projects/acme-shop/worktrees/fix-tax-rounding";

// 相対時刻をスクリーンショットごとに同じにするため、fixture の最も新しい投稿 (2026-10-02T10:30:10Z) の少し後で時計を止める。
const fixedNow = new Date("2026-10-02T10:31:00.000Z");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(fixedNow);
  // ここのテストは、画面の投稿を一覧の API の全投稿 (ツール呼び出しを含む) と比べる。
  await enableShowToolCalls(page);
});

/** 要素の列から、属性の値を上から順に返す。 */
async function attributeValues(elements: Locator, attributeName: string): Promise<string[]> {
  return elements.evaluateAll(
    (nodes, name) => nodes.map((node) => node.getAttribute(name) ?? ""),
    attributeName,
  );
}

/** 一覧の API が query の条件で返す全投稿の ID。fixture の投稿は API の既定の件数に収まる。 */
async function requestPostIds(page: Page, query: Record<string, string>): Promise<string[]> {
  const response = await page.request.get(`/api/posts?${new URLSearchParams(query)}`);
  expect(response.status()).toBe(200);
  const timeline = (await response.json()) as TimelinePage;
  expect(timeline.nextCursor).toBeNull();
  return timeline.posts.map((post) => post.id);
}

/** プロジェクトのページに、acme-shop の 2 つの worktree と、プロジェクトの投稿だけが並ぶことを確かめる。 */
async function expectAcmeShopProjectPage(page: Page): Promise<void> {
  const projectPostIds = await requestPostIds(page, { project: "acme-shop" });
  const worktrees = page.getByTestId("worktree");
  await expect(worktrees).toHaveCount(2);
  expect(new Set(await attributeValues(worktrees, "data-worktree-name"))).toEqual(
    new Set(["acme-shop", "fix-tax-rounding"]),
  );
  const posts = page.getByTestId("post");
  await expect(posts).toHaveCount(projectPostIds.length);
  expect(await attributeValues(posts, "data-post-id")).toEqual(projectPostIds);
  expect(new Set(await attributeValues(posts, "data-session-id"))).toEqual(
    new Set([claudeCart, codexTax]),
  );
}

/** worktree のページに、fix-tax-rounding の worktree の投稿だけが並ぶことを確かめる。 */
async function expectTaxWorktreePage(page: Page): Promise<void> {
  const worktreePostIds = await requestPostIds(page, {
    project: "acme-shop",
    worktree: "fix-tax-rounding",
  });
  const posts = page.getByTestId("post");
  await expect(posts).toHaveCount(worktreePostIds.length);
  expect(await attributeValues(posts, "data-post-id")).toEqual(worktreePostIds);
  expect(new Set(await attributeValues(posts, "data-session-id"))).toEqual(new Set([codexTax]));
}

test("タイムラインにプロジェクトのアイコンが並び、押すとそのプロジェクトのページへ移る", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  const projectIcons = page.getByTestId("project-icon");
  await expect(projectIcons).toHaveCount(3);
  expect(new Set(await attributeValues(projectIcons, "data-project-name"))).toEqual(
    new Set(["acme-shop", "notes-app", "weather-cli"]),
  );
  // アイコンの列はタイムラインの上にあり、タイムラインの投稿も並ぶ。
  await expect(page.getByTestId("post").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("timeline-projects.png") });

  await projectIcons.and(page.locator('[data-project-name="acme-shop"]')).click();
  await expect(page).toHaveURL(acmeShopPath);
  await expectAcmeShopProjectPage(page);
});

test("プロジェクトのページに worktree の一覧とプロジェクトの投稿だけを出し、worktree を押すとその worktree の投稿だけになる", async ({
  page,
}, testInfo) => {
  const allPostIds = await requestPostIds(page, {});
  const projectPostIds = await requestPostIds(page, { project: "acme-shop" });
  const worktreePostIds = await requestPostIds(page, {
    project: "acme-shop",
    worktree: "fix-tax-rounding",
  });
  // 絞るたびに投稿が減る fixture であることを先に確かめ、画面の絞り込みを確かめたことにする。
  expect(projectPostIds.length).toBeLessThan(allPostIds.length);
  expect(worktreePostIds.length).toBeLessThan(projectPostIds.length);

  await page.goto("/");
  await page
    .getByTestId("project-icon")
    .and(page.locator('[data-project-name="acme-shop"]'))
    .click();
  await expect(page).toHaveURL(acmeShopPath);
  await expectAcmeShopProjectPage(page);
  await page.screenshot({ path: testInfo.outputPath("project.png"), fullPage: true });

  await page
    .getByTestId("worktree")
    .and(page.locator('[data-worktree-name="fix-tax-rounding"]'))
    .click();
  await expect(page).toHaveURL(taxWorktreePath);
  await expectTaxWorktreePage(page);
  await page.screenshot({ path: testInfo.outputPath("worktree.png"), fullPage: true });

  // ブラウザの戻るで、プロジェクトのページとタイムラインへ順に戻る。
  await page.goBack();
  await expect(page).toHaveURL(acmeShopPath);
  await expectAcmeShopProjectPage(page);
  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("post")).toHaveCount(allPostIds.length);
});

test("プロジェクトと worktree のページを URL で直接開ける", async ({ page }) => {
  await page.goto(acmeShopPath);
  await expectAcmeShopProjectPage(page);

  await page.goto(taxWorktreePath);
  await expectTaxWorktreePage(page);
  // 直接開いた時も、戻るで 1 つ上のページへ移る。
  await page.getByRole("button", { name: "戻る" }).click();
  await expect(page).toHaveURL(acmeShopPath);
  await expectAcmeShopProjectPage(page);
  await page.getByRole("button", { name: "戻る" }).click();
  await expect(page).toHaveURL("/");
});

test("プロジェクトのページの投稿からスレッドへ移り、戻るとプロジェクトのページに戻る", async ({
  page,
}) => {
  await page.goto(acmeShopPath);
  await expectAcmeShopProjectPage(page);

  await page.getByTestId("post").filter({ hasText: "合計の計算を確認します" }).click();
  await expect(page).toHaveURL(`/sessions/claude-code/${claudeCart}`);
  await expect(page.getByTestId("thread-post").first()).toBeVisible();

  await page.getByRole("button", { name: "戻る" }).click();
  await expect(page).toHaveURL(acmeShopPath);
  await expectAcmeShopProjectPage(page);
  await expect(page.getByTestId("thread-post")).toHaveCount(0);
});

test("ログが無いプロジェクトの URL は、見つからない表示を出す", async ({ page }) => {
  await page.goto("/projects/no-such-project");

  await expect(page.getByTestId("project-not-found")).toBeVisible();
  await expect(page.getByTestId("post")).toHaveCount(0);
});
