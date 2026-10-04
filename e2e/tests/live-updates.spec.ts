import { appendFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test, type TestInfo } from "@playwright/test";
import type { Post, TimelinePage } from "../../server/src/post.js";

// playwright.config.ts の chromium-live-updates のプロジェクトで、ログのルートが写した fixture のサーバーに対して動く。

/** リポジトリの fixture。テストはこれを写したディレクトリに追記し、fixtures/ は書き換えない。 */
const fixturesDirectory = fileURLToPath(new URL("../../fixtures", import.meta.url));
/** fixture の Claude Code のセッションのうち、カートの合計を直すもの。 */
const claudeCart = "3f2a9c1e-5b7d-4e8a-9c6f-1a2b3c4d5e6f";
const claudeCartThreadPath = `/sessions/claude-code/${claudeCart}`;
/** テストの中で足す、新しい Claude Code のセッション。 */
const claudeWeather = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";

// 相対時刻をスクリーンショットごとに同じにするため、追記する投稿 (2026-10-02T10:30:40Z〜) の少し後で時計を止める。
const fixedNow = new Date("2026-10-02T10:31:00.000Z");

/** playwright.config.ts が渡す、fixture を写して追記するディレクトリ。 */
function liveLogsDirectory(testInfo: TestInfo): string {
  return String(testInfo.project.metadata.liveLogsDirectory);
}

/** Claude Code のセッションのログのファイルのパス。 */
function claudeCodeLogPath(testInfo: TestInfo, projectSlug: string, sessionId: string): string {
  return path.join(
    liveLogsDirectory(testInfo),
    "claude",
    "projects",
    projectSlug,
    `${sessionId}.jsonl`,
  );
}

/** Claude Code が書く 1 行のログ。fixture と同じく、読み取りが使うキーだけを持つ。 */
function claudeCodeLogLine(
  type: "user" | "assistant",
  timestamp: string,
  projectDirectory: string,
  text: string,
): string {
  return JSON.stringify({
    type,
    timestamp,
    cwd: projectDirectory,
    gitBranch: "main",
    message: {
      role: type,
      content: type === "user" ? text : [{ type: "text", text }],
    },
  });
}

/**
 * ログに行を追記する。claudeCart の fixture は途中で切れた行で終わり末尾に改行が無いため、改行から書き始め、
 * 追記した行が切れた行とつながって読めなくなるのを防ぐ。
 */
function appendLogLines(logPath: string, lines: string[]): void {
  appendFileSync(logPath, `\n${lines.join("\n")}\n`);
}

/** API が返す投稿。画面に並ぶ件数の基準にする。 */
async function requestTimelinePosts(page: Page): Promise<Post[]> {
  const response = await page.request.get("/api/posts");
  expect(response.status()).toBe(200);
  return ((await response.json()) as TimelinePage).posts;
}

test.beforeEach(async ({ page }, testInfo) => {
  // 前のテストの追記を消し、毎回 fixture の状態から始める。
  rmSync(liveLogsDirectory(testInfo), { recursive: true, force: true });
  mkdirSync(liveLogsDirectory(testInfo), { recursive: true });
  for (const agentDirectory of ["claude", "codex"]) {
    cpSync(
      path.join(fixturesDirectory, agentDirectory),
      path.join(liveLogsDirectory(testInfo), agentDirectory),
      { recursive: true },
    );
  }
  await page.clock.setFixedTime(fixedNow);
});

test("表示中にログへ追記すると新着の表示が出て、選ぶとその投稿が先頭に現れる", async ({
  page,
}, testInfo) => {
  const fixturePosts = await requestTimelinePosts(page);
  await page.goto("/");
  const posts = page.getByTestId("post");
  await expect(posts).toHaveCount(fixturePosts.length);
  await page.evaluate(() => window.scrollTo(0, 200));
  const scrollY = await page.evaluate(() => window.scrollY);

  appendLogLines(claudeCodeLogPath(testInfo, "-home-dev-acme-shop", claudeCart), [
    claudeCodeLogLine(
      "assistant",
      "2026-10-02T10:30:40.000Z",
      "/home/dev/acme-shop",
      "カートの画面でも合計が更新されることを確認しました",
    ),
  ]);

  const newPostsButton = page.getByRole("button", { name: "1 件の新しい投稿を表示" });
  await expect(newPostsButton).toBeVisible();
  // 新着は勝手に差し込まず、読んでいる位置も動かさない。
  await expect(posts).toHaveCount(fixturePosts.length);
  await expect(posts.first()).toHaveAttribute("data-post-id", fixturePosts[0]?.id ?? "");
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  await page.screenshot({ path: testInfo.outputPath("live-new-posts-button.png") });

  await newPostsButton.click();
  await expect(posts).toHaveCount(fixturePosts.length + 1);
  await expect(posts.first()).toContainText("カートの画面でも合計が更新されることを確認しました");
  await expect(posts.first()).toHaveAttribute("data-session-id", claudeCart);
  await expect(newPostsButton).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("live-new-posts-shown.png") });
});

test("スレッドを表示中にそのセッションへ追記すると末尾に発言が増える", async ({
  page,
}, testInfo) => {
  const response = await page.request.get(`/api${claudeCartThreadPath}/posts`);
  expect(response.status()).toBe(200);
  const { posts: fixtureThreadPosts } = (await response.json()) as { posts: Post[] };
  await page.goto(claudeCartThreadPath);
  const threadPosts = page.getByTestId("thread-post");
  await expect(threadPosts).toHaveCount(fixtureThreadPosts.length);

  appendLogLines(claudeCodeLogPath(testInfo, "-home-dev-acme-shop", claudeCart), [
    claudeCodeLogLine("user", "2026-10-02T10:30:40.000Z", "/home/dev/acme-shop", "テストも足して"),
    claudeCodeLogLine(
      "assistant",
      "2026-10-02T10:30:50.000Z",
      "/home/dev/acme-shop",
      "合計の再計算のテストを足しました",
    ),
  ]);

  await expect(threadPosts).toHaveCount(fixtureThreadPosts.length + 2);
  // 前からあった発言の並びはそのままで、追記した発言が末尾に増える。
  await expect(threadPosts.first()).toHaveAttribute(
    "data-post-id",
    fixtureThreadPosts[0]?.id ?? "",
  );
  await expect(threadPosts.nth(fixtureThreadPosts.length)).toContainText("テストも足して");
  await expect(threadPosts.nth(fixtureThreadPosts.length + 1)).toContainText(
    "合計の再計算のテストを足しました",
  );
  await page.screenshot({ path: testInfo.outputPath("live-thread-appended.png"), fullPage: true });
});

test("スレッドの読み込みが知らせの間隔より遅くても、追記が続く間に表示を更新する", async ({
  page,
}, testInfo) => {
  const response = await page.request.get(`/api${claudeCartThreadPath}/posts`);
  expect(response.status()).toBe(200);
  const { posts: fixtureThreadPosts } = (await response.json()) as { posts: Post[] };
  // スレッドの API の応答を、サーバーの見張りの間隔 (1 秒) より遅らせる。
  await page.route(`**/api${claudeCartThreadPath}/posts`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // 待つ間に画面が読み込みを止めた時は、続ける先が無い。
    await route.continue().catch(() => {});
  });
  // 見張りの間隔より短い間隔で追記し続け、知らせが読み込みの最中に届き続ける状態にする。
  let appendedLineCount = 0;
  const appendTimer = setInterval(() => {
    appendedLineCount += 1;
    appendLogLines(claudeCodeLogPath(testInfo, "-home-dev-acme-shop", claudeCart), [
      claudeCodeLogLine(
        "assistant",
        `2026-10-02T10:30:${String(20 + appendedLineCount).padStart(2, "0")}.000Z`,
        "/home/dev/acme-shop",
        `追記の ${appendedLineCount} 行目`,
      ),
    ]);
  }, 400);
  try {
    await page.goto(claudeCartThreadPath);
    // 追記が続いている間に、読み込みが終わって発言が並ぶ。
    await expect(page.getByTestId("thread-post").first()).toBeVisible({ timeout: 8_000 });
  } finally {
    clearInterval(appendTimer);
  }

  // 追記が止まった後は、最後の追記まで並ぶ。
  await expect(page.getByTestId("thread-post")).toHaveCount(
    fixtureThreadPosts.length + appendedLineCount,
    { timeout: 10_000 },
  );
});

test("新着を探す読み込みが知らせの間隔より遅くても、読み込みを積み重ねない", async ({
  page,
}, testInfo) => {
  const fixturePosts = await requestTimelinePosts(page);
  let inFlightCheckCount = 0;
  let maxInFlightCheckCount = 0;
  // 新着を探す読み込み (limit 付き) の応答を、サーバーの見張りの間隔 (1 秒) より遅らせ、同時に何本走るかを数える。
  await page.route("**/api/posts*", async (route) => {
    if (!new URL(route.request().url()).searchParams.has("limit")) {
      await route.continue();
      return;
    }
    inFlightCheckCount += 1;
    maxInFlightCheckCount = Math.max(maxInFlightCheckCount, inFlightCheckCount);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
    inFlightCheckCount -= 1;
  });
  await page.goto("/");
  await expect(page.getByTestId("post")).toHaveCount(fixturePosts.length);

  // 見張りの間隔より短い間隔で追記し続け、知らせが読み込みの最中に届き続ける状態にする。
  for (let appendedLineCount = 1; appendedLineCount <= 10; appendedLineCount += 1) {
    appendLogLines(claudeCodeLogPath(testInfo, "-home-dev-acme-shop", claudeCart), [
      claudeCodeLogLine(
        "assistant",
        `2026-10-02T10:30:${String(30 + appendedLineCount).padStart(2, "0")}.000Z`,
        "/home/dev/acme-shop",
        `追記の ${appendedLineCount} 行目`,
      ),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  // 追記が止まった後は、最後の追記まで新着になる。
  await expect(page.getByRole("button", { name: "10 件の新しい投稿を表示" })).toBeVisible({
    timeout: 10_000,
  });
  expect(maxInFlightCheckCount).toBe(1);
});

test("タイムラインからスレッドを開いても知らせの接続は 1 本で、両方の画面が更新される", async ({
  page,
}, testInfo) => {
  const eventsRequestUrls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/events") {
      eventsRequestUrls.push(request.url());
    }
  });
  const fixturePosts = await requestTimelinePosts(page);
  await page.goto("/");
  await expect(page.getByTestId("post")).toHaveCount(fixturePosts.length);
  // タイムラインは画面に残したまま隠れ、スレッドと一緒に知らせを受ける。
  await page.getByTestId("post").filter({ hasText: "合計の計算を確認します" }).click();
  await expect(page).toHaveURL(claudeCartThreadPath);
  const threadPosts = page.getByTestId("thread-post");
  await expect(threadPosts.first()).toBeVisible();
  const threadPostCount = await threadPosts.count();

  appendLogLines(claudeCodeLogPath(testInfo, "-home-dev-acme-shop", claudeCart), [
    claudeCodeLogLine(
      "assistant",
      "2026-10-02T10:30:40.000Z",
      "/home/dev/acme-shop",
      "スレッドとタイムラインの両方に届く発言です",
    ),
  ]);

  await expect(threadPosts).toHaveCount(threadPostCount + 1);
  await page.getByRole("button", { name: "戻る" }).click();
  await expect(page.getByRole("button", { name: "1 件の新しい投稿を表示" })).toBeVisible();
  expect(eventsRequestUrls).toHaveLength(1);
});

test("新しいセッションのファイルを足すとその投稿がタイムラインに現れる", async ({
  page,
}, testInfo) => {
  const fixturePosts = await requestTimelinePosts(page);
  await page.goto("/");
  const posts = page.getByTestId("post");
  await expect(posts).toHaveCount(fixturePosts.length);

  const weatherLogPath = claudeCodeLogPath(testInfo, "-home-dev-weather-cli", claudeWeather);
  mkdirSync(path.dirname(weatherLogPath), { recursive: true });
  // 無いファイルへの追記は、ファイルを作って書く。
  appendLogLines(weatherLogPath, [
    claudeCodeLogLine(
      "user",
      "2026-10-02T10:30:40.000Z",
      "/home/dev/weather-cli",
      "週間予報の表示を足して",
    ),
    claudeCodeLogLine(
      "assistant",
      "2026-10-02T10:30:50.000Z",
      "/home/dev/weather-cli",
      "週間予報のコマンドを追加しました",
    ),
  ]);

  const newPostsButton = page.getByRole("button", { name: "2 件の新しい投稿を表示" });
  await expect(newPostsButton).toBeVisible();
  await newPostsButton.click();
  await expect(posts).toHaveCount(fixturePosts.length + 2);
  await expect(posts.nth(0)).toContainText("週間予報のコマンドを追加しました");
  await expect(posts.nth(1)).toContainText("週間予報の表示を足して");
  await expect(posts.nth(0)).toHaveAttribute("data-session-id", claudeWeather);
  await expect(posts.nth(1)).toHaveAttribute("data-session-id", claudeWeather);
  await page.screenshot({ path: testInfo.outputPath("live-new-session.png") });
});

test("知らせの接続が切れてもつなぎ直し、新着を表示する", async ({ page }, testInfo) => {
  const fixturePosts = await requestTimelinePosts(page);
  let eventsRequestCount = 0;
  // 最初の 1 回だけ接続を失敗させる。
  await page.route(
    "**/api/events",
    async (route) => {
      eventsRequestCount += 1;
      await route.abort();
    },
    { times: 1 },
  );
  await page.goto("/");
  await expect(page.getByTestId("post")).toHaveCount(fixturePosts.length);
  await expect.poll(() => eventsRequestCount).toBe(1);

  appendLogLines(claudeCodeLogPath(testInfo, "-home-dev-acme-shop", claudeCart), [
    claudeCodeLogLine(
      "assistant",
      "2026-10-02T10:30:40.000Z",
      "/home/dev/acme-shop",
      "つなぎ直した後の発言です",
    ),
  ]);

  // つなぎ直すまでの間隔 (ブラウザの既定と web/src/log-changes.ts のどちらも約 3 秒) より長く待つ。
  await expect(page.getByRole("button", { name: "1 件の新しい投稿を表示" })).toBeVisible({
    timeout: 15_000,
  });
});
