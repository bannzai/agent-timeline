# agent-timeline

Claude Code / Codex のセッションを X のタイムライン風に表示する localhost の Web アプリ。投稿はセッションの発言、スレッドは会話、返信はそのセッションへの指示になる。OSS (MIT) で、ドキュメントとコードのコメントは日本語で書く (`documents/DIRECTION.md`「決めたこと」2026-10-04)。

## 文書

- `documents/DIRECTION.md`: なぜ作るか・何で判定するか・MVP に必要な機能の正。ここで決まっていない事項は agent が決めて「決めたこと」の表に記録する
- `documents/PROJECT.md`: 要件と制約の正。設計の決定を変える時は同じ変更の中で更新する

## 検証

ビルド・テスト・ブラウザを開く作業は、開発マシンの負荷を避けるため、開発マシンではなく外部のマシンで行う。

- agent-timeline は public リポジトリのため、外部のマシンは GitHub Actions (`.github/workflows/ci.yml`。public リポジトリは無料) を使う。simtunnel は iOS / macOS アプリ用で対象外。リポジトリを private にした場合は GitHub Actions の代わりに Devin のセッションを使う
- 開発マシンで実行しないもの: `npm ci` / `npm install` (`--package-lock-only` なし)、ビルド、テスト、dev サーバー、Playwright、ローカルのブラウザ (`--cdp` なしの agent-browser)。ファイルの編集・`git`・`gh`・`npm install --package-lock-only` (インストールもビルドもせず依存だけを解決する) は開発マシンで行ってよい
- ブランチを push して PR を作ると、PR ごとに CI が動く。PR の無いブランチで動かす時: `gh workflow run ci.yml --ref <ブランチ>`
- CI の手順が検証コマンドになる: `npm ci` → `npm run lint` → `npm run format:check` → `npm run typecheck` → `npm run build` → `npm test` → `npm run test:e2e`
- ビルドを実行してよいマシン (CI の runner 等) では、引数なしの `make` で `npm run lint` から `npm run test:e2e` までの同じ検証が順に走る (`Makefile` の `verify`)。依存の用意 (`npm ci` と `npx playwright install --with-deps chromium`) は検証ではないため `make` に含めず、先に済ませておく。開発マシンでは実行しない
- 結果を待って読む: `gh pr checks <PR> --watch`。失敗は `gh run view <run ID> --log-failed`
- 画面の確認: E2E の job が Playwright の出力 (スクリーンショットを含む) を `e2e-screenshots` artifact として上げる。`gh run download <run ID> -n e2e-screenshots -D ./tmp/e2e-screenshots-<run ID>` で取得し、PNG を Read して画面を判断する
- 画面の振る舞いを足す時は、`e2e/tests/` の E2E テストでその画面を操作し、`testInfo.outputPath(...)` にスクリーンショットを保存する。そのスクリーンショットが変更の証拠になる
- CI には本物のセッションのログが無い。テストと E2E は、ログのルートを差し替える環境変数を通して `fixtures/` の合成セッションを読む (`.claude/rules/synthetic-fixtures.md`)
- テストではなく手で画面を操作して確かめたい時は、GitHub Actions の runner 上の Chromium を操作する `webtunnel` skill を使う。`WEBTUNNEL_REPO=bannzai/agent-timeline` でセッションを起動すると、runner が `npm run start:fixtures` で `fixtures/` の合成セッションを表示したアプリを起動する (`.github/workflows/browser-session.yml`)。public リポジトリでは録画とスクリーンショットの artifact が公開されるため、本物のセッションを表示しない
- 本物のセッションへの返信には tmux と動いているエージェントが要り、CI には無い。CI では環境変数 `AGENT_TIMELINE_TMUX`・`AGENT_TIMELINE_PS` で差し替えた偽の `tmux` と `ps` (`fixtures/fake-commands/`) で確認し、本物のセッションでの確認は「ユーザー作業の一覧」issue に載せた人間の確認で行う

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
