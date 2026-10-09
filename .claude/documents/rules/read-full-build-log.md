---
load: on-demand
when: ビルド・テスト・lint を実行して、その成否を判定する
match: '^Bash:.*(xcodebuild|flutter (test|build|analyze)|npm (test|run)|pnpm (test|run|build|lint)|yarn (test|build|lint)|pytest|go (test|build|vet)|cargo (test|build|clippy)|swift (build|test)|gradle|make (test|build|check)|eslint|tsc\b|dart analyze|swiftlint)'
---
# ビルド・テスト結果の判定はログ全文で行う

ビルド・テスト・lint の成否を `tail -N` / `head -N` で切り詰めた出力だけで判定しない。切り詰めた範囲外の warning / error を見落とす（実例: `tail -3` でコンパイラ警告を見落とし、ユーザーのスクリーンショット指摘で発覚した）。

- 出力が長い場合は `./tmp/build.log` 等のファイルに保存し、全文に対して `grep -i -e warning -e error` などで検査する
- exit code だけでなく warning の有無も確認し、warning があれば完了報告に含める
