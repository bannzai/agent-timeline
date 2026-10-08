import { cp, mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PostAuthor } from "./post.js";
import { type LogRoots, logRootsFromEnv, readProjects, readTimeline } from "./timeline.js";

const claudeCart = "3f2a9c1e-5b7d-4e8a-9c6f-1a2b3c4d5e6f";
const claudeReadme = "8d4e2f6a-1c3b-4a5d-8e7f-9a0b1c2d3e4f";
const claudeSkill = "b7c5d3e1-2f4a-4b6c-8d9e-0f1a2b3c4d5e";
const codexUnit = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const codexTax = "0199b2c3-d4e5-7f6a-9b0c-1d2e3f4a5b6c";
/** 投稿を持たない Codex のサブエージェント (guardian) のセッション。 */
const codexGuardian = "0199c3d4-e5f6-7a7b-8c1d-2e3f4a5b6c7d";

/** 最終更新の日時を変えられるよう、fixture を写した一時ディレクトリ。 */
let temporaryDirectory: string;
/** temporaryDirectory に写した fixture のログのルート。 */
let copiedLogRoots: LogRoots;

/** 写した fixture のうち、ファイル名がセッション ID で終わるログのファイルの最終更新の日時を変える。 */
async function setModifiedAt(sessionId: string, timestamp: string): Promise<void> {
  for (const logRoot of Object.values(copiedLogRoots)) {
    for (const relativePath of await readdir(logRoot, { recursive: true })) {
      if (relativePath.endsWith(`${sessionId}.jsonl`)) {
        await utimes(path.join(logRoot, relativePath), new Date(timestamp), new Date(timestamp));
      }
    }
  }
}

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-timeline-"));
  // vitest.config.ts が、ログのルートの環境変数を fixtures/ の合成セッションに向けている。
  for (const [name, fixtureRoot] of Object.entries(logRootsFromEnv(process.env))) {
    await cp(fixtureRoot, path.join(temporaryDirectory, name), { recursive: true });
  }
  copiedLogRoots = {
    claudeCodeProjectsDirectory: path.join(temporaryDirectory, "claudeCodeProjectsDirectory"),
    codexSessionsDirectory: path.join(temporaryDirectory, "codexSessionsDirectory"),
  };
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("readTimeline", () => {
  it("最終更新が投稿の日時以上の時、どの limit でも全件の先頭と同じページを返す", async () => {
    // 各ファイルの最終更新を、そのファイルの最後の投稿の日時にする。
    await setModifiedAt(claudeCart, "2026-10-01T09:10:20.000Z");
    await setModifiedAt(claudeReadme, "2026-10-02T10:30:22.000Z");
    await setModifiedAt(claudeSkill, "2026-09-30T08:01:00.000Z");
    await setModifiedAt(codexUnit, "2026-10-01T09:00:10.100Z");
    await setModifiedAt(codexTax, "2026-10-02T10:00:15.000Z");
    await setModifiedAt(codexGuardian, "2026-10-01T09:00:21.000Z");
    const allPosts = (await readTimeline(copiedLogRoots, { limit: 200, cursor: null })).posts;

    expect(allPosts).toHaveLength(15);
    for (let limit = 1; limit <= allPosts.length; limit++) {
      const page = await readTimeline(copiedLogRoots, { limit, cursor: null });
      expect(page.posts).toEqual(allPosts.slice(0, limit));
    }
  });

  it("authors で絞った時も、どの limit でも全件の先頭と同じページを返す", async () => {
    await setModifiedAt(claudeCart, "2026-10-01T09:10:20.000Z");
    await setModifiedAt(claudeReadme, "2026-10-02T10:30:22.000Z");
    await setModifiedAt(claudeSkill, "2026-09-30T08:01:00.000Z");
    await setModifiedAt(codexUnit, "2026-10-01T09:00:10.100Z");
    await setModifiedAt(codexTax, "2026-10-02T10:00:15.000Z");
    await setModifiedAt(codexGuardian, "2026-10-01T09:00:21.000Z");
    const authors: ReadonlySet<PostAuthor> = new Set(["human", "agent"]);
    const allPosts = (await readTimeline(copiedLogRoots, { limit: 200, cursor: null, authors }))
      .posts;

    expect(allPosts).toHaveLength(11);
    expect(allPosts.every((post) => post.author !== "tool")).toBe(true);
    for (let limit = 1; limit <= allPosts.length; limit++) {
      const page = await readTimeline(copiedLogRoots, { limit, cursor: null, authors });
      expect(page.posts).toEqual(allPosts.slice(0, limit));
    }
  });

  it("最終更新がページに入る投稿より古いファイルは読まない", async () => {
    // claudeCart だけ、中の投稿 (2026-10-01T09:10) より古い最終更新にする。読めばページの 7 件目は
    // claudeCart の投稿 (09:10:20) になり、読まなければ codexUnit の投稿 (09:00:10) になる。
    await setModifiedAt(claudeCart, "2026-01-01T00:00:00.000Z");
    await setModifiedAt(claudeReadme, "2026-10-02T11:00:00.000Z");
    await setModifiedAt(claudeSkill, "2026-09-30T08:01:00.000Z");
    await setModifiedAt(codexUnit, "2026-10-01T09:05:00.000Z");
    await setModifiedAt(codexTax, "2026-10-02T10:10:00.000Z");
    await setModifiedAt(codexGuardian, "2026-10-01T09:05:00.000Z");
    const page = await readTimeline(copiedLogRoots, { limit: 7, cursor: null });

    expect(page.posts.map((post) => [post.session.sessionId, post.text])).toEqual([
      [claudeReadme, "README に npm start の手順を足しました"],
      [claudeReadme, 'Bash {"command":"cat package.json"}'],
      [claudeReadme, "README に起動方法を書いて"],
      [codexTax, "Math.floor で切り捨てるように直しました"],
      [codexTax, 'shell {"command":["rg","tax"]}'],
      [codexTax, "消費税の端数を切り捨てにして"],
      [codexUnit, "--unit オプションを追加しました"],
    ]);
  });
});

describe("readProjects", () => {
  it("プロジェクトと worktree を、ログのファイルの最終更新が新しい順に並べる", async () => {
    await setModifiedAt(claudeCart, "2026-10-01T09:10:20.000Z");
    await setModifiedAt(claudeReadme, "2026-10-02T10:30:22.000Z");
    await setModifiedAt(claudeSkill, "2026-09-30T08:01:00.000Z");
    await setModifiedAt(codexUnit, "2026-10-01T09:00:10.100Z");
    await setModifiedAt(codexTax, "2026-10-02T10:00:15.000Z");
    await setModifiedAt(codexGuardian, "2026-10-01T09:00:10.000Z");

    expect(await readProjects(copiedLogRoots)).toEqual([
      {
        projectName: "notes-app",
        worktrees: [
          {
            worktreeName: "notes-app",
            directory: "/home/dev/notes-app",
            gitBranch: "main",
            lastActiveAt: "2026-10-02T10:30:22.000Z",
          },
        ],
      },
      {
        projectName: "acme-shop",
        worktrees: [
          {
            worktreeName: "fix-tax-rounding",
            directory: "/home/dev/worktrees/dev/acme-shop/fix-tax-rounding",
            gitBranch: "fix/tax-rounding",
            lastActiveAt: "2026-10-02T10:00:15.000Z",
          },
          {
            worktreeName: "acme-shop",
            directory: "/home/dev/acme-shop",
            gitBranch: "feature/cart-total",
            lastActiveAt: "2026-10-01T09:10:20.000Z",
          },
        ],
      },
      {
        projectName: "weather-cli",
        worktrees: [
          {
            worktreeName: "weather-cli",
            directory: "/home/dev/weather-cli",
            gitBranch: null,
            lastActiveAt: "2026-10-01T09:00:10.100Z",
          },
        ],
      },
    ]);
  });
});
