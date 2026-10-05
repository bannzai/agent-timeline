import { describe, expect, it } from "vitest";
import type { AgentKind, Post } from "../../server/src/post.js";
import { groupConsecutiveSessionPosts } from "./post-groups";

/** テストの投稿。並びとセッションだけを見るため、ほかの値は固定する。 */
function testPost(id: string, agent: AgentKind, sessionId: string): Post {
  return {
    id,
    session: { agent, sessionId, projectDirectory: "/home/dev/acme-shop", gitBranch: "main" },
    author: "agent",
    text: id,
    toolResult: null,
    timestamp: "2026-10-01T09:00:00.000Z",
  };
}

/** まとまりを、まとまりに入った投稿の id の列にする。 */
function groupPostIds(groups: Post[][]): string[][] {
  return groups.map((group) => group.map((post) => post.id));
}

describe("groupConsecutiveSessionPosts", () => {
  it("同じセッションの連続する投稿を 1 つのまとまりにする", () => {
    const posts = [
      testPost("a1", "claude-code", "a"),
      testPost("a2", "claude-code", "a"),
      testPost("b1", "codex", "b"),
      testPost("b2", "codex", "b"),
      testPost("b3", "codex", "b"),
    ];

    expect(groupPostIds(groupConsecutiveSessionPosts(posts))).toEqual([
      ["a1", "a2"],
      ["b1", "b2", "b3"],
    ]);
  });

  it("別のセッションの投稿が挟まると、同じセッションでもまとまりを区切る", () => {
    const posts = [
      testPost("a1", "claude-code", "a"),
      testPost("b1", "claude-code", "b"),
      testPost("a2", "claude-code", "a"),
      testPost("a3", "claude-code", "a"),
    ];

    expect(groupPostIds(groupConsecutiveSessionPosts(posts))).toEqual([
      ["a1"],
      ["b1"],
      ["a2", "a3"],
    ]);
  });

  it("セッション ID が同じでも agent の種類が違えば別のまとまりにする", () => {
    const posts = [testPost("a1", "claude-code", "same"), testPost("a2", "codex", "same")];

    expect(groupPostIds(groupConsecutiveSessionPosts(posts))).toEqual([["a1"], ["a2"]]);
  });

  it("投稿が無ければまとまりも無い", () => {
    expect(groupConsecutiveSessionPosts([])).toEqual([]);
  });
});
