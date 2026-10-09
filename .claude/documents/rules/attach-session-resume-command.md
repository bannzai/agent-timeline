---
load: on-demand
when: GitHub の issue を作成する、issue や PR に内容のあるコメントを投稿する、または後から読まれるローカルドキュメント (引き継ぎ書・調査レポート・計画ファイル) を新規作成する
match: '^Bash:.*gh (issue (create|comment)|pr comment)'
---
# issue・PR コメント・ローカルドキュメントの作成時にセッション再開コマンドを添える

## ルール

- 次のアウトプットを新規作成する時、本文末尾に「## セッション再開」セクションを添える。リポジトリの owner を問わず適用する
  - GitHub issue の作成（`gh issue create`。skill 経由・非経由を問わない）
  - 内容のある PR コメントの投稿
  - 後から読まれる前提のローカルドキュメントの新規作成（引き継ぎ書・調査レポート・計画ファイルなど）
- 記載形式・セッション ID の取得方法・取得できない場合の扱いは `~/.claude/skills/commit-create-pr/SKILL.md` の「セッション再開」を SSOT とする
- 添えない対象:
  - 機械的な 1 行コメント（`ref: #N` の相互参照、`@codex review` など）
  - 既存ドキュメント・既存 issue body の部分編集（新規作成時のみ添える）
  - すぐ捨てる一時ファイル（ビルドログ、`--body-file` 用の一時 body ファイルなど）

## 既存ルールとの関係

- PR body は `commit-create-pr` skill と ~/.claude/documents/rules/pr-and-comment-follow-existing-skills.md に従う
- handover skill の実行時は同 skill の「引き継ぎ元セッション」セクション（セクション名を含む）に従う
