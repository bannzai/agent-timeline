---
load: on-demand
when: 実装・修正の作業を始めようとしていて、作業ブランチをまだ切っていない可能性がある
match: '^Bash:.*git (checkout -b|switch -c|commit|worktree add)'
---
# 作業開始時は新しいブランチを切ってから作業する

ユーザーは tmux window 単位で作業スペースを管理し、agent が別の作業スペースへ移ると見えている場所と作業実態がずれる（参照: https://github.com/bannzai/castle/issues/263 ）。

- 実装作業を始める時、作業ブランチがまだなければ現在の作業ディレクトリで新しいブランチを切る。main / master や detached HEAD のまま実装を始めない
- メイン checkout（ghq のプロジェクトディレクトリ）での作業は、worktree ではなくブランチを切って行う
- agent は worktree を自発的に派生しない。worktree で作業するのは、ユーザーがその worktree を作業スペースとして用意した場合だけ。司令塔が作業者用に `tmux-issue-setup` / `tmux-branch-setup` / `git wb` で作る worktree (`~/.claude/documents/rules/fable-task-orchestration.md`「起動経路」) と、skill が固定手順として作成先・ブランチ名を定めている worktree は、ユーザーが用意した worktree と同じ扱いで、自発的な派生に当たらない
- 例外: 稼働中の設定の実体になっている checkout ではブランチを切り替えない。bannzai/castle のメイン checkout (`~/.homesick/repos/castle`) は `~/.claude`・`~/.codex`・`~/.agents` の symlink 先で、checkout すると全セッションの rules・skill・scripts が変わる。castle を変更する時はメイン checkout を detached の `origin/main` のままにし、そのディレクトリで `git wb <ブランチ名>` を実行して `~/worktrees/bannzai/castle/<ブランチ名>` に worktree を作り、そこで作業して完了報告に絶対パスとブランチ名を書く
- ブランチを切らずに作業を始めてしまったことに気づいた場合は、その場で新しいブランチを切って引き継ぐ。main に作ってしまったコミットは新しいブランチへ移して main を作業開始前の状態に戻す。worktree への退避はしない
- 変更を失うおそれがある場合や、どのブランチに引き継ぐべきか判断できない場合は、状況を報告してユーザーの判断を仰ぐ
- 作業終了時の規律は ~/.claude/documents/rules/stay-on-final-work-branch.md
