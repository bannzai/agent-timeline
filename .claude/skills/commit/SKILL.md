---
name: commit
description: |
  今回の変更点を step-by-step でコミットするスキル。引数なしはコミットのみ、--push は push まで、
  --comment は push 後に既存 PR へやったことの詳細をコメント投稿、--codex は最後に
  ローカルの Codex レビューを行う。新規 PR の作成は commit-create-pr skill が担当する。
  ユーザーがコミット・push・PR コメントを明示的に依頼した時に使用する。
  使用例: "/commit"、"/commit --push"、"/commit --comment"
---

## 引数

- 引数なし: コミットのみ行う
- `--push`: コミット後に git push する
- `--comment`: コミット → git push → 既存 PR にやったことの詳細をコメント投稿する
- `--codex`: `--push` または `--comment` と組み合わせて、最後に Codex のコードレビューをローカルの codex-code-review skill で行う (リポジトリの owner を問わず。下記「--codex の手順」)。`--codex` 単独で指定された場合は `--push --codex` として扱う
- 新規 PR の作成 (gh pr create) は本 skill の対象外。commit-create-pr skill（~/.claude/skills/commit-create-pr/SKILL.md）を使うこと

## 共通の手順（全引数）

今回の変更に ADR に残すべき意思決定が含まれるかを、write-adr skill（~/.claude/skills/write-adr/SKILL.md）の「ADRを書くべき判断基準」に従って判断し、該当する場合はコミット前に /write-adr を実行してADRを作成すること。基準を満たさない作業記録・経緯・動作確認結果は ADR にせず PR 側（body / コメント）に書く（同 SKILL.md の「PRとの棲み分け」参照）。

コミット（および push・PR コメント投稿）の前に、これから公開するステージ済みの差分・コミットメッセージ・PR コメント本文に「漏らしてはいけない情報」(定義の SSOT は `~/.claude/skills/pre-publish-leak-check/assets/review-prompt.md`) が混入していないかを、pre-publish-leak-check skill (`~/.claude/skills/pre-publish-leak-check/SKILL.md`) で点検すること。

- コミットの前 (全引数): 点検は git のグローバル hook の commit-msg が行う。hook が検査しないリポジトリだけ、コミットメッセージをファイルに書いてから `bash ~/.claude/skills/pre-publish-leak-check/scripts/check-leaks.sh --staged --message-file <そのファイル>` を実行し、同じファイルで `git commit -F <そのファイル>` する (条件と hook に止められた時の扱いは `~/.claude/rules/no-personal-info-in-repositories.md`、手順は同 SKILL.md「Phase 1: commit の前」)
- push を伴う場合（`--push` / `--comment` / `--codex`）は push の前に、`bash ~/.claude/skills/pre-publish-leak-check/scripts/check-leaks.sh --base @{upstream}` と `bash ~/.claude/skills/pre-publish-leak-check/scripts/review-leaks.sh --base @{upstream}` を実行する (upstream が無ければ `--base origin/HEAD`)。`--comment` では投稿する本文を push の前にファイルに書き、両方に `--pr-body <そのファイル>` で渡す
- 検出時の扱い (目視の起点にすること、本物の疑いがある時、プレースホルダと判断した時に 1 行書く場所、`review-leaks.sh` の exit 3 では push に進まないこと) は同 SKILL.md「Phase 3: 検出時の扱い」に従う

`check-leaks.sh` が出す Jev の候補 `jev(<規約 id>)` (個人情報の問いで肯定側と否定側の答えが揃わない「揺れ」= `uncertain` を含む) は、各行を実物と `~/.claude/rules/<規約>` で確認して直すか、直さない理由をコミットメッセージに書くこと (候補の扱い・閾値・Jev が使えない時の fail-open の SSOT は jev-check skill `~/.claude/skills/jev-check/SKILL.md` Phase 2)。

やったことをstep-by-stepでコミットして。commit や PR コメントの body には claude が author であることは書かないでください。なおこのタスクが完了した後は勝手にcommit,push,gh pr comment しないでください。指示がある時にのみ実行するように。

git add && git commit のように && でコマンドを繋げないでください。git add と git commit はそれぞれ別のコマンドとして実行してください。

## push を伴う場合の手順（--push / --comment / --codex）

QA.md（setup-qa）管理下のプロジェクトでは、push・PR コメント投稿の前に、実施済みの動作確認を run-qa skill で QA.md へ記録すること（記録の要否・順序の SSOT は `~/.claude/documents/rules/record-qa-before-commit.md`）。エビデンスが揃っているのに QA.md を未記入のまま進めない。

コミットの後に git push をしてください。

## --comment の手順

git push の後に gh pr comment で既存 PR にコメントを投稿してください。コメントにはやったことの詳細を書いて欲しい。

モバイルアプリ開発・Web 開発の変更の場合は、動作確認スクリーンショットを `puts` CLI (bannzai/PUTS。`puts upload <画像パス>`) でアップロードして得た Markdown 埋め込みコードを PR コメント本文に含めること。機密情報が映り得る画像 (認証・secret の入力画面、実ユーザーのデータ等) だけはアップロード前に内容を検査する。対象の判定と手順は `~/.claude/documents/rules/inspect-media-before-public-upload.md` に従う。Web 開発はブラウザで動作確認する。画面に影響する変更でまだ動作確認をしていない場合は、ユーザーに行うかを質問せず、`~/.claude/rules/ui-change-screenshot-verification.md` の手段で動作確認とスクリーンショットの撮影を済ませてからコメントを投稿すること (非破壊の検証は `~/.claude/CLAUDE.md`「自律性と確認の境界」の確認対象ではない。質問する手順は commit-create-pr skill と同じく置き換えた)。検証できないと判断する時は、commit-create-pr skill と同じく Fable に相談し (メインが Fable でなければ Agent tool で `model: fable` のサブエージェントに、試した手段と使える環境を渡して判断させる)、Fable も検証できないと判断した場合だけ理由を添えて未検証と明記すること。

PR コメント本文の末尾に、このコメントを投稿したセッションを再開するコマンドを「## セッション再開」セクションとして記載すること。記載形式・セッション ID の取得方法・取得できない場合の扱いは ~/.claude/skills/commit-create-pr/SKILL.md の「セッション再開」の記載に従う（参照: ~/.claude/documents/rules/attach-session-resume-command.md）。

## --codex の手順

`--comment` を伴わない場合（`--push --codex`）で、モバイルアプリ開発・Web 開発の変更の場合は、動作確認スクリーンショットを `puts` CLI (`puts upload <画像パス>`) でアップロードして得た Markdown 埋め込みコードを、レビューの前に `gh pr comment` で PR コメントとして投稿すること。動作確認の要否・未確認時の扱いは「--comment の手順」のスクリーンショットの記載と同じ。

push の後に codex-code-review skill（~/.claude/skills/codex-code-review/SKILL.md）を実行する。リポジトリの owner では分けない（決定: ~/.claude/documents/adr/0052-local-codex-code-review-with-model-and-effort-selection.md、業務委託先のリポジトリへの適用: ~/.claude/documents/adr/0057-local-codex-review-for-all-repository-owners.md）。対象範囲は現在ブランチの PR の base との差分（同 skill の既定）。モデル・effort の選択、指摘の accept / reject、修正 commit（Codex の指摘全文を本文に含める）と push、再レビュー、PR body への記録は同 skill の手順に従う。`@codex review` コメントは投稿しない。
