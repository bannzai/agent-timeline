---
load: on-demand
when: 作業を終えて完了報告をする前で、途中でブランチを checkout し直した・別の worktree で作業した可能性がある
match: '^Bash:.*git (checkout|switch)'
---
# 作業終了時は最終作業ブランチに留まる

ユーザーは pane で `gh pr view -w` 等を実行して「その pane の作業」の PR を開くため、終了時のチェックアウトが最終作業ブランチとずれると pane の状態と作業実態が食い違う（参照: https://github.com/bannzai/castle/issues/217 ）。

- タスクの完了報告時点で、作業ディレクトリのチェックアウトは最終的に作業したブランチのままにする。ベースブランチや作業途中のブランチ (stacked PR の親を含む) へ checkout し直さない
- レビュー・比較・rebase 等で一時的に別ブランチへ checkout した場合は、完了報告の前に最終作業ブランチへ戻す
- 現在の pane と別の worktree で作業した場合は、完了報告に最終作業した worktree の絶対パスとブランチ名を明記する
- 例外: skill・スクリプトが手順としてブランチを戻すことを定めている場合はその手順に従う

作業開始時の規律は ~/.claude/documents/rules/start-work-on-new-branch.md。
