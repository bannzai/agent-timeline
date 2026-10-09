---
load: on-demand
when: gh secret set / firebase functions:secrets:set のように、変数の値で secret・設定を上書きするコマンドを実行しようとしている
match: '^(Bash:|(Write|Edit):\S+\.(sh|bash|zsh|py|rb|pl|js|mjs|cjs|ts|yml|yaml)\s).*(\bgh\b.*\b(secret|variable) set\b|\bfirebase\b.*functions:(secrets|config):set|\bwrangler\b.*\bsecret (put|bulk)\b|set_github_actions_secret_for_claud)'
block: once
---
# secret・設定値の書き込み前に値の非空確認をする

`gh secret set` / `firebase functions:secrets:set` など、変数の値で secret・設定を上書きするコマンドは、実行前に値が空でないことを確認する。空のまま実行すると既存の secret を空値で上書きして環境を壊す。

## ルール

- 書き込み直前に `[ -n "$VAR" ] || { echo "Error: VAR is empty" >&2; exit 1; }` のように、空なら異常終了して後続の書き込みを止める（`echo` だけでは書き込みが実行される）。この確認行と書き込みコマンドは同じスクリプトファイル (`./tmp/` 配下) に書いて `bash` で実行する (~/.claude/documents/rules/one-command-per-bash-call.md)
- ユーザーのシェルに値が入っている前提にしない。値の出どころ（.env / gcloud / パスワードマネージャ等）を確認してから使う
- 上書き系コマンド全般（secret・設定・データ）で、実行前に「現在値が存在するか」「新値が妥当か」を確認する
