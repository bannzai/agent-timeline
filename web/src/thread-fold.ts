import type { Post } from "../../server/src/post.js";

// 「他 x 件」を 1 回押した時に開く件数。最新の発言の直前の流れを追うのに足り、1 回開いただけで画面が発言で埋まらない件数として選んだ。
export const threadFoldExpandStep = 5;

/** スレッドの画面に出す発言の並び。上から newerPosts、「他 foldedCount 件」、firstPost の順に出す。 */
export interface ThreadFold {
  /** 最新の発言と、「他 x 件」で開いた発言。新しい順。 */
  newerPosts: Post[];
  /** 「他 x 件」に畳んだ、最初の発言と newerPosts の間の発言の件数。 */
  foldedCount: number;
  /** セッションの最初の発言。発言が 1 件も無い時は null。 */
  firstPost: Post | null;
}

/**
 * スレッドの発言 (古い順) を、最新の発言が一番上に来る並びにし、最初の発言と最新の発言の間を畳む。
 * expandedOldestPostId は「他 x 件」で開いた発言のうち最も古いものの id で、それより新しい発言を畳まずに出す。
 * null は何も開いていないことを表す。id が開いた範囲の端を指すため、開いた後に発言が増えても、開いた発言は開いたままになる。
 */
export function foldThreadPosts(posts: Post[], expandedOldestPostId: string | null): ThreadFold {
  const expandedOldestIndex =
    expandedOldestPostId === null
      ? -1
      : posts.findIndex((post) => post.id === expandedOldestPostId);
  // newerPosts に入る最も古い発言の位置。最初の発言 (0) は畳む範囲の外で別に出すため、1 より前にはしない。
  const newerStartIndex = Math.max(
    1,
    expandedOldestIndex >= 1 ? expandedOldestIndex : posts.length - 1,
  );
  return {
    newerPosts: posts.slice(newerStartIndex).reverse(),
    foldedCount: Math.max(0, newerStartIndex - 1),
    firstPost: posts[0] ?? null,
  };
}

/**
 * 「他 x 件」を押した後の expandedOldestPostId。畳んだ発言のうち最新側の threadFoldExpandStep 件を開く。
 * posts はスレッドの発言 (古い順)、foldedCount は押す前の foldThreadPosts の foldedCount。畳んだ発言が無い時は null を返す。
 */
export function expandThreadFold(posts: Post[], foldedCount: number): string | null {
  if (foldedCount <= 0) {
    return null;
  }
  return posts[1 + Math.max(0, foldedCount - threadFoldExpandStep)]?.id ?? null;
}
