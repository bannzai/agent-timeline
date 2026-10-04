import { expect, test } from "@playwright/test";

// playwright.config.ts の chromium-empty-logs のプロジェクトで、ログのルートが空のディレクトリのサーバーに対して動く。
test("ログのルートが空のディレクトリの時は空の表示を出す", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByTestId("timeline-empty")).toBeVisible();
  await expect(page.getByTestId("timeline-empty")).toContainText("まだ投稿がありません");
  await expect(page.getByTestId("post")).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath("timeline-empty.png"), fullPage: true });
});
