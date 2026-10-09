---
load: on-demand
when: skill を経由せずに git push / gh pr create / gh pr comment / gh issue comment を実行する、または PR・issue・コメントへ画像・動画を添付しようとしている
match: '^((Write|Edit):\S+\.(sh|bash|zsh|py|rb|pl|js|mjs|cjs|ts|yml|yaml)\s.*|Bash:(.*(;|&&|\|\||\s\||\$\())?\s*([A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(\S*/)?)\b(git(\s+-[cC]\s+\S+)*\s+push\b|gh\s[^;&|]*\bpr\s+(create|comment)\b|gh\s[^;&|]*\bissue\s+comment\b|gh\s[^;&|]*--attach\b|puts\s+upload\b)'
block: once
---
# PR 作成・PR コメントは既存 skill を参考にして作る

skill を経由せずに `gh pr create` / `gh pr comment` を行う時も、既存 skill の手順・body 構成に従って作る。skill (commit-create-pr・commit・auto-implement-issue 等) の手順に沿った実行で止められた時は、その skill が以下を満たしているため、書き直さずに同じコマンドを 1 回実行し直す (hook はコマンド文字列からは skill 経由かを判別できない)。

- PR 作成: `~/.claude/skills/commit-create-pr/SKILL.md` に従う。特に `## 人間が確認` セクションと、PR body 末尾のセッション再開コマンド（`claude --resume <セッションID>` / `codex resume <セッションID>` と実行ディレクトリへの `cd`）を漏らさない
- PR コメント: `~/.claude/skills/commit/SKILL.md` の「--comment の手順」に従う
- QA: QA.md 管理下のプロジェクトでは、実施済みの動作確認を QA.md へ記録してから進める (`~/.claude/documents/rules/record-qa-before-commit.md`)
- 画像・動画の添付 (`puts upload`・gh の `--attach`): 機密情報が映り得る対象かを `~/.claude/documents/rules/inspect-media-before-public-upload.md` で判定し、該当する対象だけ事前に検査する

参照: [ADR 0025](~/.claude/documents/adr/0025-pr-body-session-resume-command.md)、[ADR 0031](~/.claude/documents/adr/0031-human-verification-checklist-in-pr-body.md)
