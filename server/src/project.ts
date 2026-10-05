// プロジェクトと worktree の決め方 (documents/PROJECT.md「プロジェクトと worktree」)。画面も使うため、node の API に頼らない。

/** 作業ディレクトリが属する checkout (本体の checkout か worktree) と、そのプロジェクト。 */
export interface Checkout {
  /** プロジェクトの名前。リポジトリのディレクトリの名前で、プロジェクトを指す ID を兼ねる。 */
  projectName: string;
  /** worktree の名前。checkout のディレクトリの名前で、本体の checkout ではプロジェクトの名前と同じになる。 */
  worktreeName: string;
  /** checkout のディレクトリ。checkout の中のディレクトリで動いたセッションも、checkout の一番上を指す。 */
  directory: string;
}

/** ログがあるプロジェクト。プロジェクトの一覧の API (`/api/projects`) が返す。 */
export interface Project {
  projectName: string;
  /** プロジェクトの worktree。最近使った順に並び、先頭の lastActiveAt がプロジェクトを最後に使った日時になる。 */
  worktrees: Worktree[];
}

/** プロジェクトの 1 つの worktree。 */
export type Worktree = Omit<Checkout, "projectName"> & {
  /** worktree で最も新しいセッションを始めた時の git のブランチ。ログに書かれていなければ null。 */
  gitBranch: string | null;
  /** worktree のセッションのログの最終更新のうち、最も新しい日時。UTC の ISO 8601。 */
  lastActiveAt: string;
};

/** 一覧を絞る条件。worktreeName が null なら、プロジェクトの全 worktree のセッションを含める。 */
export interface TimelineFilter {
  projectName: string;
  worktreeName: string | null;
}

/**
 * 作業ディレクトリから checkout を取る正規表現。1 つ目の組が checkout のディレクトリ、2 つ目がプロジェクトの名前、
 * 3 つ目 (worktree の置き方だけ) が worktree の名前。上から順に試す。
 */
const checkoutPatterns = [
  // worktree の置き方 `<worktrees>/<owner>/<repo>/<worktree>`。
  /^(.*?\/worktrees\/[^/]+\/([^/]+)\/([^/]+))(?:\/|$)/,
  // ghq の本体の checkout の置き方 `<ghq>/<host>/<owner>/<repo>`。
  /^(.*?\/ghq\/[^/]+\/[^/]+\/([^/]+))(?:\/|$)/,
  // 置き方が分からない作業ディレクトリは、そのディレクトリを checkout とみなす。
  /^((?:.*\/)?([^/]+))$/,
];

/** 作業ディレクトリが属する checkout を返す。作業ディレクトリが無い時と `/` の時は null を返す。 */
export function checkoutOfDirectory(directory: string | null): Checkout | null {
  if (directory === null) {
    return null;
  }
  const normalizedDirectory = directory.replace(/\/+$/, "");
  for (const pattern of checkoutPatterns) {
    const [, checkoutDirectory, projectName, worktreeName = projectName] =
      pattern.exec(normalizedDirectory) ?? [];
    if (
      checkoutDirectory !== undefined &&
      projectName !== undefined &&
      worktreeName !== undefined
    ) {
      return { projectName, worktreeName, directory: checkoutDirectory };
    }
  }
  return null;
}

/** checkout が一覧を絞る条件に当てはまるか。 */
export function isCheckoutInFilter(checkout: Checkout | null, filter: TimelineFilter): boolean {
  return (
    checkout !== null &&
    checkout.projectName === filter.projectName &&
    (filter.worktreeName === null || checkout.worktreeName === filter.worktreeName)
  );
}
