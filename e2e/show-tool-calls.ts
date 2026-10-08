import type { Page } from "@playwright/test";
import { showToolCallsStorageKey } from "../web/src/show-tool-calls.js";

/**
 * 画面を開く前に、ツール呼び出しを表示する設定をブラウザに入れる。既定ではツール呼び出しを出さないため、
 * ツール呼び出しの表示とツール呼び出しを含む並びを確かめるテストは、開く前にこれを呼ぶ。
 */
export async function enableShowToolCalls(page: Page): Promise<void> {
  await page.addInitScript((storageKey) => {
    window.localStorage.setItem(storageKey, "true");
  }, showToolCallsStorageKey);
}
