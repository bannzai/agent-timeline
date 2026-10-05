import type { Post } from "../../server/src/post.js";

/** 2 つの投稿が同じセッションの発言か。 */
export function isSameSession(a: Post, b: Post): boolean {
  return a.session.agent === b.session.agent && a.session.sessionId === b.session.sessionId;
}

/**
 * タイムラインの投稿を、同じセッションの投稿が続く範囲ごとのまとまりに分ける。
 * 投稿の並びは変えず、別のセッションの投稿が挟まった所で区切る。まとまりの中の投稿は受け取った順のまま。
 */
export function groupConsecutiveSessionPosts(posts: Post[]): Post[][] {
  const groups: Post[][] = [];
  for (const post of posts) {
    const lastGroup = groups.at(-1);
    const lastPost = lastGroup?.at(-1);
    if (lastGroup !== undefined && lastPost !== undefined && isSameSession(lastPost, post)) {
      lastGroup.push(post);
    } else {
      groups.push([post]);
    }
  }
  return groups;
}
