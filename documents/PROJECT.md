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
- **返信の API はエージェントに文字を打ち込む**: 返信は、セッションが動いている tmux の pane へキー入力を送って届ける。つまりこの API は、このマシンでコマンドを実行するのと同じ力を持つ。`Origin` / `Host` がこのアプリ自身でないリクエストは拒否し、同じブラウザで開いている別のサイトからエージェントに指示を送れないようにする
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
