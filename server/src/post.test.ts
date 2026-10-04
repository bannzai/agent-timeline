import { describe, expect, it } from "vitest";
import { postId } from "./post.js";

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
