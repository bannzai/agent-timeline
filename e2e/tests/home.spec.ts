import { expect, test } from "@playwright/test";

test("the app loads and reaches the server", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "agent-timeline" })).toBeVisible();
  await expect(page.getByTestId("server-status")).toHaveText("server: ok");

  await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
});
