import { expect, test } from "@playwright/test";

test("画面が開き、サーバーに届く", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "agent-timeline" })).toBeVisible();
  await expect(page.getByTestId("server-status")).toHaveText("server: ok");

  await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
});
