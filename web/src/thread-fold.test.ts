import { describe, expect, it } from "vitest";
import type { Post } from "../../server/src/post.js";
import { expandThreadFold, foldThreadPosts, threadFoldExpandStep } from "./thread-fold";

/** スレッドの発言を古い順に postCount 件作る。id は 0 から始まる番号の文字列。 */
function threadPosts(postCount: number): Post[] {
  return Array.from({ length: postCount }, (_, postIndex): Post => ({
    id: String(postIndex),
    session: {
      agent: "claude-code",
      sessionId: "session",
      projectDirectory: "/home/dev/acme-shop",
      gitBranch: "main",
    },
    author: "agent",
    text: `${postIndex} 件目`,
    toolResult: null,
    timestamp: new Date(Date.UTC(2026, 9, 1, 9, 0, postIndex)).toISOString(),
  }));
}

/** 画面に上から並ぶ発言の id と、「他 x 件」の件数。 */
function shownLayout(posts: Post[], expandedOldestPostId: string | null) {
  const fold = foldThreadPosts(posts, expandedOldestPostId);
  return {
    newerPostIds: fold.newerPosts.map((post) => post.id),
    foldedCount: fold.foldedCount,
    firstPostId: fold.firstPost?.id ?? null,
  };
}

describe("foldThreadPosts", () => {
  it.each([
    [0, { newerPostIds: [], foldedCount: 0, firstPostId: null }],
    [1, { newerPostIds: [], foldedCount: 0, firstPostId: "0" }],
    [2, { newerPostIds: ["1"], foldedCount: 0, firstPostId: "0" }],
  ])("発言が %i 件の時は畳まない", (postCount, expected) => {
    expect(shownLayout(threadPosts(postCount), null)).toEqual(expected);
  });

  it("発言が 3 件以上の時は、最新の発言を上に、最初の発言を下に出し、間を畳む", () => {
    expect(shownLayout(threadPosts(3), null)).toEqual({
      newerPostIds: ["2"],
      foldedCount: 1,
      firstPostId: "0",
    });
    expect(shownLayout(threadPosts(20), null)).toEqual({
      newerPostIds: ["19"],
      foldedCount: 18,
      firstPostId: "0",
    });
  });

  it("開いた発言より新しい発言を、新しい順に出す", () => {
    expect(shownLayout(threadPosts(6), "3")).toEqual({
      newerPostIds: ["5", "4", "3"],
      foldedCount: 2,
      firstPostId: "0",
    });
  });

  it("何も開いていない時に発言が増えると、最新の発言が入れ替わり畳んだ件数が増える", () => {
    expect(shownLayout(threadPosts(4), null)).toEqual({
      newerPostIds: ["3"],
      foldedCount: 2,
      firstPostId: "0",
    });
    expect(shownLayout(threadPosts(6), null)).toEqual({
      newerPostIds: ["5"],
      foldedCount: 4,
      firstPostId: "0",
    });
  });

  it("開いた後に発言が増えると、開いた発言は開いたまま先頭に加わる", () => {
    expect(shownLayout(threadPosts(4), "1")).toEqual({
      newerPostIds: ["3", "2", "1"],
      foldedCount: 0,
      firstPostId: "0",
    });
    expect(shownLayout(threadPosts(6), "1")).toEqual({
      newerPostIds: ["5", "4", "3", "2", "1"],
      foldedCount: 0,
      firstPostId: "0",
    });
  });

  it("開いた発言の id がスレッドに無い時は、何も開いていない時と同じに出す", () => {
    expect(shownLayout(threadPosts(4), "missing")).toEqual(shownLayout(threadPosts(4), null));
  });
});

describe("expandThreadFold", () => {
  it("畳んだ発言のうち最新側から決まった件数を開き、残りは畳んだままにする", () => {
    const posts = threadPosts(threadFoldExpandStep * 2 + 4);
    const foldedCount = foldThreadPosts(posts, null).foldedCount;

    const expandedOldestPostId = expandThreadFold(posts, foldedCount);

    const fold = foldThreadPosts(posts, expandedOldestPostId);
    expect(fold.newerPosts).toHaveLength(1 + threadFoldExpandStep);
    expect(fold.foldedCount).toBe(foldedCount - threadFoldExpandStep);
  });

  it("残りが決まった件数以下なら、全部を開いて「他 x 件」を無くす", () => {
    const posts = threadPosts(threadFoldExpandStep + 2);
    const foldedCount = foldThreadPosts(posts, null).foldedCount;

    const fold = foldThreadPosts(posts, expandThreadFold(posts, foldedCount));

    expect(fold.foldedCount).toBe(0);
    expect(fold.newerPosts.map((post) => post.id)).toEqual(
      posts
        .slice(1)
        .map((post) => post.id)
        .reverse(),
    );
  });

  it("畳んだ発言が無ければ何も開かない", () => {
    expect(expandThreadFold(threadPosts(2), 0)).toBeNull();
  });
});
