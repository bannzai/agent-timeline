import { expect, test } from "@playwright/test";

/** API の応答のうち、E2E で確かめる部分。 */
interface PostsResponse {
  posts: { session: { agent: string; sessionId: string } }[];
}

test("本番のビルドのサーバーが fixture の両 agent の投稿を返す", async ({ request }) => {
  const timelineResponse = await request.get("/api/posts");
  expect(timelineResponse.status()).toBe(200);
  const timeline = (await timelineResponse.json()) as PostsResponse;
  for (const agent of ["claude-code", "codex"]) {
    expect(timeline.posts.some((post) => post.session.agent === agent)).toBe(true);
  }

  const newestSession = timeline.posts[0]?.session;
  expect(newestSession).toBeDefined();
  const threadResponse = await request.get(
    `/api/sessions/${newestSession?.agent}/${newestSession?.sessionId}/posts`,
  );
  expect(threadResponse.status()).toBe(200);
  const thread = (await threadResponse.json()) as PostsResponse;
  expect(thread.posts.length).toBeGreaterThan(0);
  for (const post of thread.posts) {
    expect(post.session.sessionId).toBe(newestSession?.sessionId);
  }
});

test("スレッドとプロジェクトの URL には画面を返し、ほかの知らないパスは 404 を返す", async ({
  request,
}) => {
  for (const pagePath of [
    "/sessions/claude-code/3f2a9c1e-5b7d-4e8a-9c6f-1a2b3c4d5e6f",
    "/projects/acme-shop",
    "/projects/acme-shop/worktrees/fix-tax-rounding",
  ]) {
    const pageResponse = await request.get(pagePath);
    expect(pageResponse.status()).toBe(200);
    expect(pageResponse.headers()["content-type"]).toContain("text/html");
  }

  expect((await request.get("/no-such-page")).status()).toBe(404);
  expect((await request.get("/api/no-such-api")).status()).toBe(404);
});
