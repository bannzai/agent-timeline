// 計測用の合成のログを作る。2026-10-06 の開発者のマシンの数 (Claude Code 約 4.7 万・Codex 約 1,600 ファイル、slug 約 2,000) に合わせた。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.argv[2];
const claudeProjectCount = 2000;
const claudeLogsPerProject = 24;
const codexLogCount = 1600;

/** 作業ディレクトリ cwd で始めたセッションの、1 行の合成のログを返す。 */
const line = (cwd) =>
  `${JSON.stringify({ type: "user", cwd, timestamp: "2026-10-01T00:00:00.000Z", message: { role: "user", content: "hello" } })}\n`;

for (let projectIndex = 0; projectIndex < claudeProjectCount; projectIndex++) {
  const projectDirectory = path.join(root, "claude", `-home-dev-project-${projectIndex}`);
  await mkdir(projectDirectory, { recursive: true });
  await Promise.all(
    Array.from({ length: claudeLogsPerProject }, (_, logIndex) =>
      writeFile(
        path.join(
          projectDirectory,
          `00000000-0000-4000-8000-${String(projectIndex * 100 + logIndex).padStart(12, "0")}.jsonl`,
        ),
        line(`/home/dev/project-${projectIndex}`),
      ),
    ),
  );
}

for (let logIndex = 0; logIndex < codexLogCount; logIndex++) {
  const month = String((logIndex % 12) + 1).padStart(2, "0");
  const day = String((logIndex % 28) + 1).padStart(2, "0");
  const dayDirectory = path.join(root, "codex", "2026", month, day);
  await mkdir(dayDirectory, { recursive: true });
  await writeFile(
    path.join(
      dayDirectory,
      `rollout-2026-${month}-${day}T00-00-00-00000000-0000-7000-8000-${String(logIndex).padStart(12, "0")}.jsonl`,
    ),
    line(`/home/dev/codex-${logIndex}`),
  );
}
