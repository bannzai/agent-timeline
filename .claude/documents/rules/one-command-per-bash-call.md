# Bash ツールは 1 回の呼び出しで 1 コマンドだけ実行する

Bash ツールで `&&` / `||` / `;` / 改行を使って複数のコマンドを 1 回の呼び出しに連結しない。連結すると permissions.allow に一致せず、auto mode でも承認プロンプトになる (参照: https://code.claude.com/docs/en/permissions の「Compound commands」「Read-only commands」。設計判断: ~/.claude/documents/adr/0046-reject-compound-bash-commands-and-redirect-permission-prompts-to-rewrite.md )。

PreToolUse hook `~/.claude/scripts/claude-pretooluse-hook-reject-compound-commands` が連結コマンドを exit 2 でブロックし、分割方法を案内する。連結していない単一コマンドが承認プロンプトになる時は、その直前に PermissionRequest hook `~/.claude/scripts/claude-permissionrequest-hook-bash-rewrite-guide` が deny して書き直し方を返すので、案内に従って書き直す (検出対象・要因の一覧は各スクリプトのヘッダーコメントを SSOT とする)。書き直しても人間の承認が本当に必要な操作なら、その旨をユーザーへの返答に書いて止まり、同じコマンドを繰り返し投げない (例外: 単発の deny を「agent には実行不可」と確定してユーザーへ依頼する前に、対象の skill・rules にそのコマンドの既存の解決手順が無いか確認したうえで、要因を取り除いた書き直しか同一コマンドの再試行を 1 回だけ行ってよい。その 1 回でも deny されたら繰り返さない)。

## ルール

- 1 回の Bash 呼び出しにつき 1 つのコマンド (パイプライン) だけを書く。パイプ `|`・リダイレクト `>` `2>&1`・コマンド置換・サブシェルは 1 コマンドの一部として使ってよい
- 互いに独立したコマンドは、1 メッセージ内の複数の Bash 呼び出しに分けて並列に実行する。前の結果に依存するコマンドは、結果を見てから次の呼び出しで実行する
- `cd <dir> && <cmd>` は書かない。絶対パスを渡して `cd` を無くす (作業ディレクトリは Bash 呼び出し間で保持される)
- ループ・条件分岐・exit code のログ記録のように 1 つのシェルで連続実行する必要がある処理は、Write ツールで `./tmp/` 配下のスクリプトファイルに書いて `bash ./tmp/<名前>.sh` で実行する。`bash -c '...'` で連結コマンドを包んで hook を通さない
- 分割しても実行の承認境界は変わらない。分割した各コマンドが `~/.claude/CLAUDE.md`「自律性と確認の境界」の「確認なしで進める」に当たるなら、ユーザーに確認を求めず実行する。連結を分割する作業自体は確認の理由にならない

## 既存ルールとの関係

- ~/.claude/rules/shell-quote-heredoc-delimiters.md: heredoc の使用は本ルールで妨げない
- ~/.claude/documents/rules/verify-subagent-report-with-evidence.md: 委譲先に出力と exit code をログへ記録させる時は、連結コマンドではなくスクリプトファイル (`cmd > ./tmp/task.log 2>&1` と `echo "exit=$?" >> ./tmp/task.log` の 2 行) を `bash` で実行させる
