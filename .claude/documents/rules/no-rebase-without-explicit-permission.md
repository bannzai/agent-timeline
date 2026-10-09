---
load: on-demand
when: git rebase、git pull --rebase、pull.rebase の設定のように、rebase で履歴を書き換えようとしている
match: '^(Bash:|(Write|Edit):\S+\.(sh|bash|zsh|py|rb|pl|js|mjs|cjs|ts|yml|yaml)\s).*(\bgit\b.*\brebase\b|\bgit(\s+-[cC]\s+\S+)*\s+r(\s|$))'
block: once
---
# 事前の許可なしに git rebase をしない

rebase は push 済みブランチで force push（破壊的操作）を要するため、履歴の統合は merge で行う（起票元: https://github.com/bannzai/castle/issues/262 ）。

## ルール

- `git rebase` をデフォルトで使わない。`git pull --rebase` や `git config pull.rebase true` など、pull 経由で rebase になる形も使わない
- ブランチをベースブランチに追随させる時は merge を使う（例: `git merge origin/main`）。コンフリクトの解消も merge の継続で行う
- どうしても rebase をしたい場合は、対象ブランチと理由を提示して実行前にユーザーの許可を取る。skill が rebase を含む手順を提示している場合も、実行する段で許可を取る

## 既存ルールとの関係

- CLAUDE.md「自律性と確認の境界」の破壊的操作の確認の具体化で、承認境界の SSOT は CLAUDE.md 側
- 「merge を使う」は PR のマージを許可するものではない。PR のマージは ~/.claude/skills/auto-merge-pr/SKILL.md の手順に従う
