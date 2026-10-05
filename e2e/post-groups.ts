import { expect, type Locator } from "@playwright/test";
import type { Post } from "../server/src/post.js";

/**
 * 画面のタイムラインのまとまりを、上から順に、まとまりに入った投稿の id の列で返す。まとまりは、アイコンを持つ投稿から
 * 次にアイコンを持つ投稿の手前まで。あわせて、まとまりの続きの投稿が投稿者の行を持たず縦線を持つことを確かめる。
 * posts はタイムラインの投稿 (data-testid="post") の Locator。
 */
export async function renderedPostGroups(posts: Locator): Promise<string[][]> {
  const renderedPosts = await posts.evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-post-id") ?? "",
      hasAvatar: node.querySelector('[data-testid="avatar"]') !== null,
      hasHeader: node.querySelector(".post-header") !== null,
      hasThreadLine: node.querySelector('[data-testid="thread-line"]') !== null,
    })),
  );
  const groups: string[][] = [];
  for (const renderedPost of renderedPosts) {
    if (renderedPost.hasAvatar) {
      expect(renderedPost.hasHeader).toBe(true);
      groups.push([renderedPost.id]);
      continue;
    }
    expect(renderedPost.hasHeader).toBe(false);
    expect(renderedPost.hasThreadLine).toBe(true);
    const lastGroup = groups.at(-1);
    expect(lastGroup).toBeDefined();
    lastGroup?.push(renderedPost.id);
  }
  return groups;
}

/** 新しい順の投稿を、同じセッションの投稿が続く範囲ごとに、投稿の id の列へ分ける。画面のまとまりの期待値にする。 */
export function expectedPostGroups(posts: Post[]): string[][] {
  const groups: string[][] = [];
  posts.forEach((post, postIndex) => {
    const previousPost = posts[postIndex - 1];
    if (
      previousPost !== undefined &&
      previousPost.session.agent === post.session.agent &&
      previousPost.session.sessionId === post.session.sessionId
    ) {
      groups.at(-1)?.push(post.id);
    } else {
      groups.push([post.id]);
    }
  });
  return groups;
}
