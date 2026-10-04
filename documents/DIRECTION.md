---
status: building
decision_date:
cycle_days: 14
veto_wait_hours: 12
daily_issue_cap: 3
launched_at:
---

# 方向性: agent-timeline

## 仮説

tmux の複数 window で Claude Code / Codex を並列に走らせている開発者 (まず bannzai 自身) は、各セッションが今何をしているかを知るために window を順に開いている。全セッションの会話ログを X のタイムライン風の 1 画面に流し、投稿への返信でそのセッションに指示を送れれば、window を切り替えずに状況の把握と指示ができる。

ネタ枠 (起票元 https://github.com/bannzai/IdeaMemo/issues/352 ) のため、収益は目的にしない。需要・競合・マネタイズの事前評価 (evaluate-service-idea) は行っていない。

## 判定基準

| 指標 | 計測元 (skill / コマンド) | 継続のしきい値 | 打ち切り条件 | 転換の条件 |
| --- | --- | --- | --- | --- |
| 14 日間でサーバーを起動した日数 (bannzai 自身) | アプリが起動のたびに `~/.agent-timeline/usage.jsonl` へ 1 行書く。`jq -r 'select(.event == "start") \| .at[0:10]' ~/.agent-timeline/usage.jsonl \| sort -u \| wc -l` を直近 14 日分で数える | 4 日以上 | 2 回連続で 2 日未満 | 起動は 4 日以上だが返信の送信が 0 件なら、返信機能を外して閲覧専用に絞る |
| 14 日間に返信で送った指示の件数 (bannzai 自身) | 同ファイルの `event == "reply"` の行数 | 10 件以上 | (起動日数の打ち切り条件に従う) | 上の行と同じ |
| GitHub の star 数 | `gh api repos/bannzai/agent-timeline --jq .stargazers_count` | 公開の告知から 28 日で 10 以上 | star では打ち切らない (自分が使っていれば継続) | 28 日で 30 以上なら npm への公開 (`npx agent-timeline`) と導入手順の整備に進む |

## 必要な機能

- [ ] タイムライン: Claude Code (`~/.claude/projects/<プロジェクト>/<セッション ID>.jsonl`) と Codex (`~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl`) の会話ログを読み、ユーザーの指示と agent の発言を新しい順の投稿として 1 画面に流す。投稿者はセッション (プロジェクト名・ブランチ・agent の種類) で表す
- [ ] スレッド: 投稿を開くと、そのセッションの会話履歴が返信の連なりとして読める。ツール呼び出しは 1 行に畳む
- [ ] 自動更新: ログの追記を検知し、再読み込みなしで新しい投稿が流れる
- [ ] 返信で指示: スレッドの返信欄に書いた文を、そのセッションが動いている tmux の pane へ送る。セッションと pane の対応付け (pane の作業ディレクトリと agent のプロセスから求める) を含む。対応する pane が無いセッションは返信欄を出さない
- [ ] 起動: `git clone` して 1 コマンドで起動する。サーバーは `127.0.0.1` だけで待ち受け、返信の API は Origin と Host を検査する (ブラウザで開いた別サイトから agent に指示を送られないため)
- [ ] 利用記録: 判定基準の計測元になる `~/.agent-timeline/usage.jsonl` (起動と返信の日時だけ。会話の内容は書かない)

MVP に入れないもの: 新しいセッションの起動、いいね・リポスト、検索、ログイン、別のマシンからの閲覧、npm への公開。

## デザインの方向

UI は X に似せる (2026-10-04、bannzai)。画面の構成・配色・投稿の並び・操作を、X のタイムラインとポストの詳細画面に合わせる。X のロゴと名称は使わない。モックは無い (関門 2 の issue: https://github.com/bannzai/agent-timeline/issues/3 。Claude Design のモックを受領したら `documents/design/` に保存してここから参照する)。

## 決めたこと

| 日付 | 場面 | 決めたこと | 決めた人 |
| --- | --- | --- | --- |
| 2026-10-04 | 関門 1 の前 | リポジトリ名 agent-timeline・公開設定 public・構成 Web (Vite + React + Node サーバー) ( https://github.com/bannzai/IdeaMemo/issues/352 の立ち上げ情報) | bannzai |
| 2026-10-04 | 関門 1 の前 | ビルド・ブラウザの動作確認は外部マシン (public の間は GitHub Actions、private にしたら Devin) で行い、開発マシンでは行わない (`/create-new-app` の起動時の指示) | bannzai |
| 2026-10-04 | 関門 1 の前 | 需要・競合・マネタイズの事前評価は行わない (ネタ枠で、収益を目的にせず、ストア配布も課金も無いため) | agent |
| 2026-10-04 | 関門 1 の前 | この文書は castle の型 (見出し固定) に合わせて日本語で書く。README・AGENTS.md・コードのコメントは、関門 1 で OSS として扱うかの返答が出るまで英語で書く (英語から日本語へ直す方が、公開後に日本語から英語へ直すより影響が小さいため) | agent |
| 2026-10-04 | 関門 1 の前 | サーバー側の DB・ログイン・外部への送信は持たない (読むのは手元のログファイルだけ)。このため利用規約・プライバシーポリシー・紹介サイトは作らず、README の記載で代える (同じ構成の bannzai/fusen に合わせた) | agent |
| 2026-10-04 | 関門 1 | 作る。必要な機能は上の一覧のままでよい | bannzai |
| 2026-10-04 | 関門 1 | OSS として扱い、MIT ライセンスにする。ドキュメントを含めて日本語でよい (README・AGENTS.md・PROJECT.md・コードのコメントを日本語に直した) | bannzai |
| 2026-10-04 | 関門 2 | UI は X に似せる。Claude Design のモックを待たずに実装する | bannzai |
| 2026-10-04 | 関門 2 | X のロゴと名称は使わない (他社の商標のため) | agent |

## agent に任せること

- ライブラリの選定、画面の細部、API の形、ログの読み方の詳細
- CI の構成、テストの書き方
- 紹介サイトを後から作るか (star の転換の条件に達した時に判断する)
