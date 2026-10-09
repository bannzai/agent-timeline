---
load: on-demand
when: gcloud / Firebase のプロジェクト新規作成、課金アカウントのリンク、組織・フォルダの作成のように、アカウント配下に永続的なリソース階層や課金影響を生む操作をしようとしている
match: '^(Bash|Write|Edit):.*(\bgcloud\b.*\bprojects create\b|\bgcloud\b.*\bbilling\b.*\blink\b|\bfirebase\b.*\bprojects:(create|addfirebase)\b|\bgcloud\b.*\b(folders|organizations) create\b)'
block: once
---
# クラウドプロジェクト・課金リソースは確認してから作成する

gcloud / Firebase のプロジェクト作成、課金アカウントのリンクなど、アカウント配下に永続的なリソース階層や課金影響を生む操作は、ユーザーの明示的な承認なしに実行しない（参照: https://github.com/bannzai/yomon/pull/17 ）。

## ルール

- 対象: `gcloud projects create`、`firebase projects:create` / `projects:addfirebase`、`gcloud billing projects link`、課金プランの変更、組織・フォルダ作成など、新しいプロジェクト/課金の紐付けを作る操作すべて
- タスクレベルの依頼 (「本番で動くところまでやって」等) は承認を**含まない**。実行前に、作成するプロジェクト ID・使用する Google アカウント・リンクする課金アカウントを提示して AskUserQuestion で確認する
- 既存プロジェクトへのデプロイ・設定変更・シークレット設定は本ルールの対象外（CLAUDE.md の「自律性と確認の境界」に従う）
