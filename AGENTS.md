# agent-timeline

An X-like timeline on localhost of Claude Code / Codex sessions: posts are session activity, threads are conversations, replies send instructions to the session.

## Documents

- `documents/DIRECTION.md` (Japanese) is the source of truth for why this exists, how it is judged and which features the MVP needs. Decisions that it leaves open are made by the agent and recorded in its "決めたこと" table.
- `documents/PROJECT.md` is the source of truth for requirements and constraints. Update it in the same change when a design decision changes.

## Verification

Builds, tests and anything that opens a browser run on an external machine, not on the local development machine, to keep its load low.

- agent-timeline is a public repository, so the external machine is GitHub Actions (`.github/workflows/ci.yml`, free for public repositories). simtunnel is for iOS / macOS apps and does not apply. If the repository ever becomes private, use a Devin session instead of GitHub Actions
- Do not run these locally: `npm ci` / `npm install` (without `--package-lock-only`), builds, tests, the dev server, Playwright, a local browser (agent-browser without `--cdp`). Editing files, `git`, `gh` and `npm install --package-lock-only` (resolves dependencies without installing or building) are fine locally
- Push the branch and open a pull request; CI runs on every pull request. To run it on a branch without a pull request: `gh workflow run ci.yml --ref <branch>`
- CI steps, which are the verification commands: `npm ci` → `npm run lint` → `npm run format:check` → `npm run typecheck` → `npm run build` → `npm test` → `npm run test:e2e`
- Wait for and inspect results: `gh pr checks <pr> --watch`, then `gh run view <run-id> --log-failed` for failures
- Visual check: the E2E job uploads Playwright output, including screenshots, as the `e2e-screenshots` artifact. Download it with `gh run download <run-id> -n e2e-screenshots -D ./tmp/e2e-screenshots-<run-id>` and Read the PNG files to judge the UI
- When adding UI behavior, extend an E2E test in `e2e/tests/` so it drives the UI and saves a screenshot with `testInfo.outputPath(...)`; that screenshot is the evidence of the change
- CI has no real session logs. Tests and E2E read the synthetic sessions under `fixtures/` through the environment variables that override the log roots (`.claude/rules/synthetic-fixtures.md`)
- Interactive check in a remote browser (clicking through the UI by hand rather than by a test): the `webtunnel` skill, which runs Chromium on a GitHub Actions runner. It needs `.github/workflows/browser-session.yml` and the `TS_OIDC_CLIENT_ID` / `TS_OIDC_AUDIENCE` secrets; until both exist, use the E2E screenshots
- Replying to a real session needs tmux and a running agent, which CI does not have. CI covers it with a fake `tmux` executable on `PATH`; the check against a real session is a manual one listed in the user task issue

<!-- ai-review-config begin -->
<!--
このブロックは自動生成です。直接編集せず、テンプレートを更新してから再生成してください。
内容は AI コードレビュー時の挙動指示であり、コードベース自体への規約ではありません。
-->

## レビュー時の応答スタイル

- 応答は日本語で行う

## レビュー範囲外

以下は自動レビューで指摘しない (別の検出経路があるため):

- コンパイルエラー・型エラー (ローカル/CI のビルドで検出される)
- Lint/フォーマット違反 (リンター・フォーマッターで検出される)
<!-- ai-review-config end -->
