---
load: on-demand
when: タスクを書き出す・渡す・受けて始める (issue を作成する、作業者・サブエージェントに指示書やプロンプトを渡す、複数の部分からなる依頼に着手してタスクリストや計画を立てる、完了条件が書かれていない issue・依頼に着手する)
match: '^(Agent|Workflow):|^Bash:.*(gh issue create|tmux-(issue|branch)-setup)'
---
# タスクごとに完了条件を書く

タスクを書き出す・渡す・受けて始める時は、タスクごとに完了条件 (何が揃えば終わりか) を書く。完了条件が無いタスクは、途中の報告と完了を区別できない。

## 書く場所

| 場面 | 書く場所 |
| --- | --- |
| issue を作成する | 本文の「完了条件」セクション |
| 作業者・サブエージェントにタスクを渡す | 指示書、または Agent tool・`codex:codex-rescue` のプロンプト |
| 複数の部分からなる依頼に着手する | タスクリスト (タスク管理ツール、または `./tmp/` の計画ファイル) の各項目 |
| 完了条件が書かれていない issue・依頼に着手する | 依頼から導いた完了条件を着手前に書く。auto-implement-issue skill では Pull Request 本文、対話では着手を伝える返答 |

## 書き方

- 主語はタスクの成果物にし、会話ログ・差分・コマンドの結果から達成を判定できる形にする (例: 「`scripts/foo.sh` が `--dry-run` を受け付け、`bash scripts/test/test-foo.sh` が exit 0」)。「テストが通る」「PR を作成する」のような、何も変更しなくても満たせる汎用の条件だけにしない
- タスクを複数の部分に分けた時は、全体の完了条件とは別に部分ごとの完了条件を書く
- agent が実行できない実機・マニュアル動作確認は実装 issue の完了条件に入れない (`~/.claude/documents/rules/defer-manual-verification-to-release.md`)
- 指示書の項目は `~/.claude/documents/rules/fable-task-orchestration.md` 手順 2、`/goal` の提案は `~/.claude/documents/rules/goal-for-long-tasks.md` を正とし、本ルールは完了条件の書き方だけを定める
- 完了条件のうち未達の項目は `~/.claude/documents/rules/report-undone-scope-in-completion.md` に従って完了報告に書く
