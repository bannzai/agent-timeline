---
load: on-demand
when: 環境変数の値・設定状況を確認するために、引数なしの env / printenv で全変数を出力しようとしている
match: '^Bash:\s*(env|printenv)\s*([|>].*)?$'
block: once
---
# 環境変数は変数名を指定して確認する

環境変数の値・設定状況の確認に、引数なしの `env` / `printenv` (全変数のダンプ) を使わない。API キー・トークン類の値がセッションの transcript に残る (起票元: https://github.com/bannzai/castle/pull/1280 )。

## ルール

- 対象の変数だけを見る (例: `printenv AUTO_KILL_TMUX_WINDOW`)。secret を持ちうる変数 (API キー・トークン類) は値を出さず、有無だけを確認する (`[ -n "${VAR:-}" ] && echo set || echo unset`)
- `printenv` に渡す名前は 1 回に 1 つにする。macOS の `printenv` は先頭が未設定だと何も出さずに exit 1 で終わり、後続の変数まで未設定と読み違える (起票元: https://github.com/bannzai/castle/issues/1378 )
- 設定されている変数の一覧が要る時は、変数名の列だけを出す (`env | cut -d= -f1`)
- `env VAR=value <コマンド>` / `env -i <コマンド>` のようにコマンドの実行環境を作る用途は対象外
