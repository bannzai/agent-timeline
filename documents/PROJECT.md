# agent-timeline

このマシンで動いている Claude Code と Codex のセッションの様子を、X のタイムライン風に表示する localhost の Web アプリ。各セッションの会話が投稿として流れ、投稿を開くとスレッドになり、スレッドへの返信がそのセッションへの指示として送られる。

なぜ作るか・何で成否を判定するか・MVP の機能の一覧は [DIRECTION.md](DIRECTION.md) にある。このファイルは、実装が守る要件と制約を持つ。

## 入力

agent-timeline は、エージェントが既に書いているファイルを読むだけで、エージェントを包んだり起動したりしない。

| エージェント | セッションのログの場所 | 補足 |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/<プロジェクトの slug>/<セッション ID>.jsonl` | 1 行に 1 つの JSON。`type` が `user` / `assistant` の行が `message`・`cwd`・`gitBranch`・`timestamp`・`sessionId` を持つ。`message.content` は文字列か、ブロック (`text`・`thinking`・`tool_use`・`tool_result`) の配列。ほかの種類の行 (`attachment`・`mode`・`file-history-snapshot` など) もある。2026-10-04 に Claude Code 2.1.289 のログで確認 |
| Codex CLI | `~/.codex/sessions/<年>/<月>/<日>/rollout-<日時>-<ID>.jsonl` | 1 行に 1 つの JSON で、`type` と `payload` を持つ。`session_meta` が `cwd` と `git` を持つ。`response_item` は `payload.type` が `message` (`role`・`content`)・`reasoning`・`custom_tool_call`・`custom_tool_call_output`。`event_msg` は `task_started` / `task_complete`。2026-10-02 のセッションのファイルで確認 |

どちらの形式も各ツールの内部のもので文書化されておらず、リリースのたびに変わり得る。読み取りは、理解できない行で失敗せず読み飛ばす。形式の知識はエージェントごとに 1 つのモジュールに閉じる。

テストを実行するマシンには本物のログが無いため、2 つのルートディレクトリは環境変数 (`AGENT_TIMELINE_CLAUDE_PROJECTS_DIR`・`AGENT_TIMELINE_CODEX_SESSIONS_DIR`) で差し替えられるようにする。

## 制約

- **localhost だけ**: サーバーは `127.0.0.1` で待ち受ける。ログインが無いため、別のマシンから届くと全ての会話が見えてしまう
- **返信の API はエージェントに文字を打ち込む**: 返信は、セッションが動いている tmux の pane へキー入力を送って届ける。つまりこの API は、このマシンでコマンドを実行するのと同じ力を持つ。`Origin` / `Host` がこのアプリ自身でないリクエストは拒否し、同じブラウザで開いている別のサイトからエージェントに指示を送れないようにする
- **サーバー側に保存しない**: DB を持たず、ログの写しも作らない。アプリが書くファイルは利用記録 `~/.agent-timeline/usage.jsonl` (起動と返信の日時だけ。会話の内容は書かない) だけで、DIRECTION.md の判定基準の計測元になる
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
