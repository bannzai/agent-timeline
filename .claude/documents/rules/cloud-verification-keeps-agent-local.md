---
load: on-demand
when: 定期チェック・自動化・CI の設計や提案で、ビルド・動作確認 (simulator・ブラウザ・E2E) の実行場所や LLM (agent) の実行場所を決めようとしている、または GitHub Actions の workflow に LLM ツール (claude-code-action・codex exec 等) や push トリガーの LLM 実行を入れようとしている
match: '^((Write|Edit):.*\.github/workflows/|Bash:.*(claude-code-action|codex exec|gh workflow run|launchctl|crontab))'
---
# 動作確認はクラウドへ出し、agent はローカルで動かす

ビルド・動作確認 (simulator・ブラウザ・E2E) は、処理の重さによらずクラウドの実行環境で行う。クラウド側 (GitHub Actions の runner) に置くのは実行環境だけで、それを操作する agent (LLM) はローカルの Claude Code / Codex か Devin のセッションで動かす。

## ルール

- 動作確認の経路の判定は ios-simulator skill Phase 1 (iOS / macOS)、agent-browser skill「ローカル / リモート (webtunnel) の使い分け」と webtunnel skill (Web) に従う
- GitHub Actions の workflow に LLM ツール (claude-code-action・`claude -p`・`codex exec` 等) を常設しない。commit や push をトリガーに LLM を走らせる設計も採らない。LLM の認証情報を CI に置くことになり、ローカルの agent と挙動が分かれるため (起票元: https://github.com/bannzai/castle/issues/1315 )
- ローカルの Mac を使う動作確認を定期実行に組み込む時は、`macos-resource-check` を通し、マシンに負担がかからない間隔にする (例: 深夜に 1 回)。public repo の simtunnel / webtunnel は間隔を短くしてよい (例: 毎時)
- 定期実行の QA は、前回から差分が無いことを理由に省略しない (run-qa skill Phase 1)
