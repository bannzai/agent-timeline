import { useEffect, useState } from "react";
import type { PostSession } from "../../server/src/post.js";
import type { Project, Worktree } from "../../server/src/project.js";
import { relativeTimeText } from "./format";
import { BackHeader, ProjectAvatar, Spinner } from "./PostParts";
import { handleInAppLinkClick, routePath } from "./route";
import { Timeline } from "./Timeline";

/** プロジェクトの一覧の API の読み込みの状態。 */
type ProjectsState =
  { status: "loading" } | { status: "loaded"; projects: Project[] } | { status: "error" };

/** プロジェクトの一覧の API (`/api/projects`) を、画面を開いた時に 1 度読む。 */
function useProjects(): ProjectsState {
  const [projectsState, setProjectsState] = useState<ProjectsState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/projects", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`プロジェクトの一覧の API が ${response.status} を返した`);
        }
        const { projects } = (await response.json()) as { projects: Project[] };
        setProjectsState({ status: "loaded", projects });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setProjectsState({ status: "error" });
        }
      });
    return () => controller.abort();
  }, []);
  return projectsState;
}

/**
 * ホームのタイムラインの上に、ログがあるプロジェクトのアイコンを最近使った順に横に並べる。押すとプロジェクトのページへ移る。
 * 一覧を読めるまでと、プロジェクトが 1 つも無い時は何も出さない。
 */
export function ProjectRow({ onOpenProject }: { onOpenProject: (projectName: string) => void }) {
  const projectsState = useProjects();
  if (projectsState.status !== "loaded" || projectsState.projects.length === 0) {
    return null;
  }
  return (
    <nav className="project-row" aria-label="プロジェクト">
      {projectsState.projects.map((project) => (
        <a
          key={project.projectName}
          className="project-row-item"
          href={routePath({ screen: "project", projectName: project.projectName })}
          data-testid="project-icon"
          data-project-name={project.projectName}
          onClick={(event) => handleInAppLinkClick(event, () => onOpenProject(project.projectName))}
        >
          <ProjectAvatar projectName={project.projectName} />
          <span className="project-row-name">{project.projectName}</span>
        </a>
      ))}
    </nav>
  );
}

/** プロジェクトのページ。プロジェクトの worktree の一覧と、プロジェクトの全セッションの投稿のタイムラインを出す。 */
export function ProjectPage({
  projectName,
  onBack,
  onOpenWorktree,
  onOpenThread,
}: {
  projectName: string;
  onBack: () => void;
  onOpenWorktree: (worktreeName: string) => void;
  onOpenThread: (session: PostSession) => void;
}) {
  const projectsState = useProjects();
  const project =
    projectsState.status === "loaded"
      ? projectsState.projects.find((loadedProject) => loadedProject.projectName === projectName)
      : undefined;
  // 相対時刻の基準。読み込むたびに描き直すため、描画の時点の時刻を使う。
  const now = new Date();
  return (
    <section aria-label="プロジェクト">
      <BackHeader title={projectName} subtitle="プロジェクト" onBack={onBack} />
      {projectsState.status === "loading" && <Spinner />}
      {projectsState.status === "error" && (
        <div className="load-error" role="alert">
          <p>worktree の一覧を読み込めませんでした</p>
        </div>
      )}
      {projectsState.status === "loaded" && project === undefined ? (
        <div className="empty" data-testid="project-not-found">
          <h2 className="empty-title">プロジェクトが見つかりません</h2>
          <p className="empty-text">ログが消えたか URL が違います</p>
        </div>
      ) : (
        <>
          {project !== undefined && (
            <>
              <div className="project-profile">
                <ProjectAvatar projectName={projectName} />
                <h2 className="project-profile-name">{projectName}</h2>
              </div>
              <h3 className="section-title">worktree</h3>
              <ul className="worktree-list">
                {project.worktrees.map((worktree) => (
                  <WorktreeItem
                    key={worktree.worktreeName}
                    projectName={projectName}
                    worktree={worktree}
                    now={now}
                    onOpen={() => onOpenWorktree(worktree.worktreeName)}
                  />
                ))}
              </ul>
              <h3 className="section-title">投稿</h3>
            </>
          )}
          <Timeline filter={{ projectName, worktreeName: null }} onOpenThread={onOpenThread} />
        </>
      )}
    </section>
  );
}

/** プロジェクトのページの worktree の一覧の 1 行。押すと worktree のページへ移る。 */
function WorktreeItem({
  projectName,
  worktree,
  now,
  onOpen,
}: {
  projectName: string;
  worktree: Worktree;
  now: Date;
  onOpen: () => void;
}) {
  return (
    <li>
      <a
        className="worktree-item"
        href={routePath({ screen: "worktree", projectName, worktreeName: worktree.worktreeName })}
        data-testid="worktree"
        data-worktree-name={worktree.worktreeName}
        onClick={(event) => handleInAppLinkClick(event, onOpen)}
      >
        <div className="post-header">
          <span className="post-name">{worktree.worktreeName}</span>
          {worktree.gitBranch !== null && (
            <span className="post-handle">@{worktree.gitBranch}</span>
          )}
          <span className="post-handle" aria-hidden="true">
            ·
          </span>
          <span className="post-handle">
            <time dateTime={worktree.lastActiveAt}>
              {relativeTimeText(worktree.lastActiveAt, now)}
            </time>
          </span>
        </div>
        <div className="worktree-directory">{worktree.directory}</div>
      </a>
    </li>
  );
}

/** worktree のページ。その worktree で動いたセッションの投稿だけのタイムラインを出す。 */
export function WorktreePage({
  projectName,
  worktreeName,
  onBack,
  onOpenThread,
}: {
  projectName: string;
  worktreeName: string;
  onBack: () => void;
  onOpenThread: (session: PostSession) => void;
}) {
  return (
    <section aria-label="worktree">
      <BackHeader title={worktreeName} subtitle={projectName} onBack={onBack} />
      <Timeline filter={{ projectName, worktreeName }} onOpenThread={onOpenThread} />
    </section>
  );
}
