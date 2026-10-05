# 偽の tmux と ps

CI には tmux も動いているエージェントも無いため、返信の送信はこの偽のコマンドで確かめる。サーバーには環境変数 `AGENT_TIMELINE_TMUX` と `AGENT_TIMELINE_PS` でこのファイルを渡す。使い方は各スクリプトの先頭のコメントにある。

`panes.tsv` (`tmux list-panes` の出力) と `processes.txt` (`ps` の出力) は、E2E と `npm run start:fixtures` が `fixtures/` の合成セッションに組み合わせる表。Claude Code の acme-shop のセッションだけが返信でき、Codex の weather-cli のセッションは同じディレクトリに Codex の pane が 2 つあって送り先を決められず、ほかのセッションは同じ種類のエージェントの pane が無い状態を表す。
