---
load: on-demand
when: 環境変数の一覧や値を確認するために env / printenv を引数なしで実行しようとしている
match: '^Bash:\s*(/usr/bin/)?(env|printenv)\s*$'
block: once
---
# 素の env / printenv で環境変数の値を出力しない

引数なしの `env` / `printenv` は、全環境変数の値 (API キー・トークン・secret) を transcript に平文で残し、そこからサブエージェント・Jev・daily-retrospective へ広がる (起票元: https://github.com/bannzai/castle/pull/1289 )。

## ルール

- 変数が設定されているかだけを確認する: `[ -n "${VAR:-}" ]` を使ったスクリプト、または `printenv VAR | wc -c` (値を表示しない)
- 変数名の一覧が要る時は値を落とす: `env | cut -d= -f1`
- 値そのものが要る時は、その変数だけを対象にし、値を echo せずスクリプトの中で使う
