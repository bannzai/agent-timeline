import { describe, expect, it } from "vitest";
import { postId, toolResultText } from "./post.js";

describe("toolResultText", () => {
  it("文字列の結果と、text を持つ要素の配列の結果を文にする", () => {
    expect(toolResultText("src/tax.ts")).toBe("src/tax.ts");
    expect(
      toolResultText([
        { type: "text", text: "1 行目" },
        { type: "image", source: {} },
        { type: "text", text: "2 行目" },
      ]),
    ).toBe("1 行目\n2 行目");
  });

  it("500 文字を超える結果は先頭の 500 文字にする", () => {
    expect(toolResultText("あ".repeat(501))).toBe("あ".repeat(500));
  });

  it.each([
    ["空の文字列", ""],
    ["画像だけの配列", [{ type: "image", source: {} }]],
    ["知らない形", { output: "src/tax.ts" }],
  ])("文を持たない結果 (%s) は null を返す", (_, toolOutput) => {
    expect(toolResultText(toolOutput)).toBeNull();
  });
});

describe("postId", () => {
  it("同じセッションの ID の文字列の大小が、行とブロックの番号の大小と一致する", () => {
    const ids = [
      postId("claude-code", "session", 2, 0),
      postId("claude-code", "session", 2, 9),
      postId("claude-code", "session", 2, 10),
      postId("claude-code", "session", 9, 0),
      postId("claude-code", "session", 10, 0),
    ];

    expect([...ids].sort()).toEqual(ids);
  });
});
