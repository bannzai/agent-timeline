# agent-timeline

このマシンで動いている Claude Code と Codex のセッションの様子を、X のタイムライン風に表示する localhost の Web アプリ。各セッションの会話が投稿として流れ、投稿を開くとスレッドになり、スレッドへの返信がそのセッションへの指示として送られる。

なぜ作るか・何で成否を判定するか・MVP の機能の一覧は [DIRECTION.md](DIRECTION.md) にある。このファイルは、実装が守る要件と制約を持つ。

## 入力

agent-timeline は、エージェントが既に書いているファイルを読むだけで、エージェントを包んだり起動したりしない。

| エージェント | セッションのログの場所 | 補足 |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/<プロジェクトの slug>/<セッション ID>.jsonl` | 1 行に 1 つの JSON。`type` が `user` / `assistant` の行が `message`・`cwd`・`gitBranch`・`timestamp`・`sessionId` を持つ。`message.content` は文字列か、ブロック (`text`・`thinking`・`tool_use`・`tool_result`) の配列。`tool_result` は、呼び出しの `tool_use` の `id` を `tool_use_id` に持つ。ほかの種類の行 (`attachment`・`mode`・`file-history-snapshot` など) もある。2026-10-04 に Claude Code 2.1.289 のログで確認 |
| Codex CLI | `~/.codex/sessions/<年>/<月>/<日>/rollout-<日時>-<ID>.jsonl` | 1 行に 1 つの JSON で、`type` と `payload` を持つ。`session_meta` が `cwd` と `git` を持つ。`response_item` は `payload.type` が `message` (`role`・`content`)・`reasoning`・`custom_tool_call` / `function_call` (ツール呼び出し)・`custom_tool_call_output` / `function_call_output` (ツールの結果。呼び出しと同じ `call_id` を持つ)。`event_msg` は `task_started` / `task_complete`。2026-10-02 のセッションのファイルで確認 |

どちらの形式も各ツールの内部のもので文書化されておらず、リリースのたびに変わり得る。読み取りは、理解できない行で失敗せず読み飛ばす。形式の知識はエージェントごとに 1 つのモジュールに閉じる。

テストを実行するマシンには本物のログが無いため、2 つのルートディレクトリは環境変数 (`AGENT_TIMELINE_CLAUDE_PROJECTS_DIR`・`AGENT_TIMELINE_CODEX_SESSIONS_DIR`) で差し替えられるようにする。

### 投稿にしない行

投稿にするのは、人間が agent に向けて書いた指示、agent の返答、agent のツール呼び出しだけにする。各ツールは、人間の行 (`user` / `role: user`) に人間が書いたのではない文も書くため、次の行は投稿にしない。件数は、開発者のマシンの 2026-10-01〜10-08 に更新された Claude Code のログ 1,769 ファイル (`isMeta`・`isSidechain` の行を除く `user` の行) と、2026-09-01 以降の Codex のログ 833 ファイルで数えた (2026-10-08)。人間の指示が 1,347 行だったのに対し、ツールが差し込んだ文の方が多く、除かないとタイムラインが会話にならない。

| エージェント | 行 | 件数 | 扱い |
| --- | --- | --- | --- |
| Claude Code | `<task-notification>` で始まる: バックグラウンドの処理の完了通知 | 1,633 | 投稿にしない |
| Claude Code | `<command-message>` で始まる: skill (`/foo 引数`) の起動。`<command-name>` と `<command-args>` を持ち、展開された SKILL.md の本文は `isMeta` の行 (719 行) に別に書かれる | 490 | 人が打った `/foo 引数` の 1 行の投稿にする |
| Claude Code | `<command-name>` で始まる: Claude Code が手元で処理するコマンド (`/usage` 1,092・`/login` 25・`/exit` 17・`/model` 17 など)。agent には届かず、出力は `<local-command-stdout>` に書かれる。`/usage` は `claude -p '/usage'` (`entrypoint` が `sdk-cli`) のセッションで、agent の返答が無い | 1,189 | 投稿にしない (skill の起動と見分けるのは行の先頭のタグ。2026-10 の Claude Code 2.1.179〜2.1.294 で、`<command-name>` で始まる行の次は `<local-command-stdout>` かログの末尾で、assistant の行が続いたことは無い) |
| Claude Code | `<local-command-stdout>` で始まる: 手元で処理するコマンドの出力 | 77 | 投稿にしない |
| Claude Code | `[Request interrupted by user]`・`[Request interrupted by user for tool use]`: 人が処理を中断した通知 | 60 + 41 | 投稿にしない (中断は人の操作だが、本文が無い) |
| Claude Code | `<bash-input>`・`<bash-stdout>`・`<bash-stderr>`: 人が `!` で実行したシェルのコマンドと出力 | 37 + 35 (`<bash-stderr>` は `<bash-stdout>` の行の中に 35) | 投稿にしない (agent への指示ではない) |
| Claude Code | 「Another Claude session sent a message:」で始まる: 別のセッション (teammate・サブエージェント) の報告 (`<teammate-message>` の JSON) の転送 | 59 (ほかに `isMeta` の行に 554) | 投稿にしない。agent の発言としても残さない (報告の本文は相手のセッションのログにあり、この行への agent の返答は assistant の行に残るため) |
| Claude Code | 本文が `[Image #n]` だけ: 画像の添付の印 | 3 (`[Image #n]` で始まる行は 30 で、残りは文が添えられている) | 投稿にしない。文に添えられている時は印ごと残す |
| Claude Code | `[SYSTEM NOTIFICATION - NOT USER INPUT]` で始まる通知、`<system-reminder>` だけの行 | 0 (この期間のログには現れなかった。`<system-reminder>` は `<task-notification>` の中に 11 行) | 投稿にしない (issue #31 の指摘に基づく) |
| Codex | `session_meta` の `source` が `subagent` のセッション: 承認の要否を別のモデルに判定させる guardian (`{"subagent":{"other":"guardian"}}`) と、並列の作業に spawn したスレッド (`{"subagent":{"thread_spawn":...}}`)。guardian の `user` の message は親のセッションの会話の写し (`[1] user: ...` の列。2,904 message) を持つ | 255 + 190 ファイル (833 ファイル中) | セッションごと投稿にしない (Claude Code の `isSidechain` と同じ扱い) |
| Codex | `user` の message の要素のうち、`<environment_context>`・`# AGENTS.md instructions`・`<skill>`・`<recommended_plugins>`・`<hook_prompt `・`<codex_internal_context `・`<no retained transcript delta entries>` で始まるもの: Codex が指示に差し込む文脈 | 909 + 847 + 200 + 65 + 8 + 5 + 138 | その要素だけ投稿にしない |
| Codex | `event_msg` の行 (`task_started`・`task_complete`・`turn_aborted` など) | 72 (`turn_aborted`) | 投稿にしない (`response_item` 以外の行は読まない) |

ほかに、Claude Code の `isMeta` (Claude Code が差し込んだ文)・`isSidechain` (サブエージェントの会話)・`isCompactSummary` (会話の圧縮の要約) の行と、Codex の `developer` の message (Codex が agent に渡す指示) も投稿にしない。人間が書いた文は `<div>` や `<pasted_content>` で始まることもあるため、除外は既知の書き出しに限る。

## 返信の送り先

返信は、セッションが動いている tmux の pane へキー入力として送る。送り先の pane は次の条件でちょうど 1 つに決まる時だけ使い、決まらないセッションのスレッドには返信欄を出さない。

- pane の作業ディレクトリ (`tmux list-panes -a` の `pane_current_path`) が、セッションの最後の発言の作業ディレクトリと同じ
- pane のシェル (`pane_pid`) か、その直下のプロセスが、同じ種類の agent である。agent の種類は `ps` の引数の実行ファイルの名前 (`claude` / `codex`。`node` で動くものはスクリプトの名前) で見分ける。tmux の `pane_current_command` は、Claude Code のネイティブ版ではバージョン番号 (`2.1.282` など)、npm で入れた Codex では `node` になり、agent を見分けられない (2026-10-05 に tmux 3.6a・Claude Code 2.1.282 のマシンで確認)。直下より深いプロセスを見ないのは、agent がツールとして起動した別の agent (Claude Code から実行した `codex exec` など) を取り違えないため
- その agent が対話で動いている。`claude -p` / `--print` と、対話の画面を開かないサブコマンド (`claude mcp`・`codex exec`・`codex review` など) は端末の入力を読まず、送った本文が終わった後のシェルに残ってコマンドとして実行されうるため、agent とみなさない。`ps` は引数を空白でつないで出し、空白を含むオプションの値があると引数の境目が分からないため、値を取るオプションがある起動は、後ろのどこかにサブコマンドの名前があれば対話でないとみなす (起動時の指示の語がサブコマンドの名前と重なる時も送り先にならないが、送るべきでない pane に送るよりよいため)
- pane がコピーモードなどのモードにいない (`pane_in_mode` が 0)。モードの間は、送ったキーがモードの操作として使われ、agent に届かないため
- その agent のプロセスが、端末の手前のプロセスグループにいて (`ps` の stat に `+`)、止まっていない (stat が `T` で始まらない)。止めた (Ctrl+Z) agent や裏で動かした agent の pane では、キー入力を受け取るのはシェルで、本文がコマンドとして実行されてしまうため

同じディレクトリで動いている同じ種類の agent が 2 つ以上ある時は、送り先を決めずに返信できないとする。過去のセッションも、今そのディレクトリで動いている agent の pane に対応付く (ログと pane の agent のプロセスを結びつける情報が無いため)。

送信は、送る直前に対応付けをやり直してから、`tmux send-keys -t <pane の ID> -l -- <本文>` と `tmux send-keys -t <pane の ID> Enter` を、シェルを通さず引数の配列で実行する。Enter の直前にも対応付けをやり直し、送り先が変わっていれば Enter を送らない (本文は pane の入力欄に残るため、画面は返信欄の本文を消して、同じ本文を送り直して入力欄でつながらないようにする)。tmux は引数の末尾の `;` をコマンドの区切りとして取り除くため、末尾が `;` の本文は最後の `;` の前に `\` を足して渡す (2026-10-05 に tmux 3.6a で確認)。同時に届いた返信は 1 つずつ送り、2 つの本文が Enter の前につながらないようにする。CI には tmux も動いている agent も無いため、tmux と ps の実行ファイルは環境変数 (`AGENT_TIMELINE_TMUX`・`AGENT_TIMELINE_PS`) で偽のコマンド (`fixtures/fake-commands/`) に差し替えられるようにする。

## プロジェクトと worktree

タイムラインは、プロジェクト → worktree の順に絞って見られる。セッションがどのプロジェクトと worktree のものかは、セッションを始めた作業ディレクトリ (Claude Code は `cwd` を持つ最初の行、Codex は `session_meta.cwd`) だけで決める。途中で作業ディレクトリが変わっても、セッションは始めた worktree に属する。

2026-10-05 に開発者のマシンのログの `cwd` を集めると、worktree は `~/worktrees/<owner>/<repo>/<ブランチ>`、本体の checkout は ghq の `~/ghq/github.com/<owner>/<repo>` に置かれていた。worktree の中のディレクトリ (`<ブランチ>/tmp/...`) や本体の checkout の中のディレクトリ (`<repo>/ios`) で始めたセッションもあった。そこで作業ディレクトリを次の順に読み、最初に当てはまったもので決める (`server/src/project.ts`)。

| 作業ディレクトリ | checkout | プロジェクト | worktree |
| --- | --- | --- | --- |
| `…/worktrees/<owner>/<repo>/<名前>/…` | `…/worktrees/<owner>/<repo>/<名前>` | `<repo>` | `<名前>` |
| `…/ghq/<host>/<owner>/<repo>/…` | `…/ghq/<host>/<owner>/<repo>` | `<repo>` | `<repo>` (本体の checkout) |
| それ以外 | 作業ディレクトリそのもの | 最後のディレクトリの名前 | プロジェクトと同じ (本体の checkout) |

- プロジェクトはリポジトリのディレクトリの名前で表し、worktree と本体の checkout を同じプロジェクトにまとめる。owner の違う同じ名前のリポジトリは 1 つのプロジェクトになる。プロジェクトの名前を URL (`/projects/<プロジェクト>`) で短く読めることを優先した
- worktree はブランチではなく checkout のディレクトリで表す。本体の checkout はセッションごとにブランチが変わるため、ブランチでは同じ場所の作業が分かれてしまう
- 置き方の分からない作業ディレクトリ (一時ディレクトリなど) は、そのディレクトリを本体の checkout とみなす
- 数万のセッションのログの全体を読まずに済ませるため、作業ディレクトリはログの先頭の近くだけを読んで覚えておく。Claude Code は始めた作業ディレクトリごとにログのディレクトリ (slug) を分けるため、slug ごとに 1 つのログを読めば足りる。プロジェクトを最近使った順に並べる時も、投稿を読まずにログのファイルの最終更新で比べる

## 制約

- **localhost だけ**: サーバーは `127.0.0.1` で待ち受ける。ログインが無いため、別のマシンから届くと全ての会話が見えてしまう。同じ理由で、API は `Host` がこのマシン (`127.0.0.1` / `localhost`) でないリクエストを拒否する。ブラウザで開いた別のサイトが自分のドメインを `127.0.0.1` に向け直して (DNS rebinding) 会話を読むのを防ぐ
- **返信の API はエージェントに文字を打ち込む**: 返信は、セッションが動いている tmux の pane へキー入力を送って届ける。つまりこの API は、このマシンでコマンドを実行するのと同じ力を持つ。`Origin` / `Host` がこのアプリ自身でないリクエストは拒否し、同じブラウザで開いている別のサイトからエージェントに指示を送れないようにする。`Origin` は Host (この検査でこのマシンに限られる) と同じオリジンの時だけ受け付ける (待ち受けのポートと比べないのは、`npm run dev` では画面と API が vite の同じオリジンから届くため)。別のサイトがプリフライトなしで送れる形式を受け付けないため、Content-Type は `application/json` だけを受け付ける。本文は 1 行に限り、改行と制御文字を含む本文は受け付けない
- **サーバー側に保存しない**: DB を持たず、ログの写しも作らない。アプリが書くファイルは利用記録 `~/.agent-timeline/usage.jsonl` (起動と返信の日時だけ。会話の内容は書かない) だけで、DIRECTION.md の判定基準の計測元になる。テストが実際のホームディレクトリに書かないため、記録先のディレクトリは環境変数 `AGENT_TIMELINE_USAGE_DIR` で差し替えられるようにする。書けない時も起動は続ける
- **マシンの外へ出さない**: 計測・テレメトリ・実行時の外部へのリクエストを持たない
- **本物のセッションのログをリポジトリに入れない**: 非公開のコード・個人情報・secret を含むため。fixture とスクリーンショットは手書きの合成セッションから作る (`.claude/rules/synthetic-fixtures.md`)

## インフラの決定

| 領域 | 決定 | 理由 |
| --- | --- | --- |
| DB・ストレージ | 持たない | エージェントのログのファイルがデータそのもの |
| ホスティング | 持たない。利用者のマシンで clone から動かす | データが手元にあり、非公開のもの |
| 認証 | 持たない。`127.0.0.1` での待ち受けと `Origin` / `Host` の検査で守る | 自分のマシンで 1 人が使う |
| 計測 | 手元の利用記録と GitHub の star 数 | 外部へ送信しない制約に合う外部サービスが無い |
| アラート (GCP・Crashlytics)・課金・ストア配布 | 対象外 | クラウドのプロジェクト・モバイルアプリ・支払いが無い |

## 検証

ビルド・テスト・画面の確認の方法は [AGENTS.md](../AGENTS.md) にある。要点: 開発マシンではビルドもブラウザでの表示も行わず、GitHub Actions が合成の fixture で行う。
