---
load: on-demand
when: git でブランチを checkout・switch する、新しいブランチを切る、または PR をマージする
match: '^Bash:.*(git (checkout|switch|branch)|gh pr merge|gh-pr-merge)'
---
# main ブランチをチェックアウトしたままにしない

ローカルの `main` ブランチ (master も同様) には checkout せず、`origin/main` を使う。どこかの作業スペースが `main` を保持していると、worktree 側の PR マージ後処理が `fatal: 'main' is already used by worktree at '<パス>'` で失敗する (起票元: https://github.com/bannzai/castle/issues/539 )。

- 新しいブランチは `git checkout -b <ブランチ名> origin/main` で切る。最新の main を見る・追随するには detached の `git checkout origin/main` か `git merge origin/main` を使う
- PR のマージには素の `gh pr merge --delete-branch` ではなく gh-pr-merge を使う (素のコマンドはローカルの `main` を checkout して残す。挙動の SSOT は `~/bin/gh-pr-merge` のヘッダーコメント)
- `main` に checkout していることに気づいたら、`git switch --detach` (対象指定なし) で同一コミットのまま ref を解放する。上記の fatal に遭遇した時は、該当 worktree が clean ならそこで同じ操作をして報告し、dirty なら操作せずブロック内容を報告する
