# QA.md 管理下のプロジェクトでは PR 作成・PR コメントの前に QA を実施してよく、実施済みの検証は記録してから進める

## ルール

- 実施 (任意): QA.md（setup-qa）管理下のプロジェクトでは、コミット系 skill（`/commit-create-pr`、`/commit` の `--push` / `--comment`（`--codex` 指定を含む）、および skill を経由しない同等の commit・PR 操作）の実行を完了する（push・PR 作成・PR コメント投稿）前に、QA（run-qa による実施と QA.md への記録）を行ってよい
- 記録 (必須): 変更・追加した feature に QA.md があり、検証（E2E 実行結果・スクリーンショット等）を実施済みなら、QA.md へ記録（チェック・エビデンス・last_verified_commit / last_verified_at）してから PR 作成・PR コメント投稿へ進む。エビデンスが揃っているのに QA.md を未記入のまま PR に含めない（起票元: https://github.com/bannzai/castle/issues/412 ）
- setup-qa の運用対象なのに QA.md が無い新規 feature は、QA.md の新設（setup-qa の雛形生成）を検討する
- 未検証項目が残る場合は、未検証である旨を QA.md に明記したうえで進めてよい
- 順序は、コード変更のコミット → QA 実施・QA.md 記録 → QA.md を含めてコミット・push・PR とする

## 既存ルールとの関係

- QA の実施手順・QA.md への記録方法は run-qa skill（~/.claude/skills/run-qa/SKILL.md）、QA.md のフォーマットは setup-qa の references/qa-md-format.md が SSOT。`pr-and-comment-follow-existing-skills.md` の「記録してから進める」は記録 (必須) の段階を指し、実施を義務にはしない
- 本ルールは、QA の実施・記録を commit・PR 作成のタスクの依頼範囲に常設で含める指示であり、CLAUDE.md「自律性と確認の境界」の「依頼範囲の拡大」の確認対象には当たらない
- ~/.claude/rules/ui-change-screenshot-verification.md は UI 変更の描画確認義務を定める。本ルールはその検証結果を QA.md へ記録するタイミングを定め、役割が重ならない
