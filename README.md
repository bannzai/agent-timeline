# agent-timeline

手元で動いている Claude Code と Codex のセッションを、X のタイムライン風に眺める localhost の Web アプリ。

- **タイムライン**: 全セッションの指示と返答が、新しい順に 1 つのフィードに流れる
- **スレッド**: 投稿を開くと、そのセッションの会話が返信の連なりとして読める
- **返信で指示**: スレッドに返信すると、その文がセッションの動いている tmux の pane に送られる

## 使い方

Node.js 22.12 以上が必要です。

```sh
git clone https://github.com/bannzai/agent-timeline.git
cd agent-timeline
npm ci
npm start
```

`npm start` は画面とサーバーをビルドしてから起動します。起動したらブラウザで http://127.0.0.1:7878 を開きます。

返信は、セッションが tmux の pane で動いている時に送れます。セッションの作業ディレクトリで同じ種類のエージェント (Claude Code / Codex) が動いている pane が 1 つだけの時に返信欄が出て、書いた 1 行がその pane に入力されます。同じディレクトリで同じ種類のエージェントを 2 つ以上動かしている時は、送り先を決められないため返信欄を出しません。

ポートを変える時は、環境変数 `AGENT_TIMELINE_PORT` を指定します。

```sh
AGENT_TIMELINE_PORT=8000 npm start
```

## データの扱い

agent-timeline は、Claude Code (`~/.claude/projects`) と Codex (`~/.codex/sessions`) が手元に書いているセッションのログを読みます。待ち受けは `127.0.0.1` だけで、ログの写しを保存せず、どのサーバーにも送信しません。書き込むファイルは `~/.agent-timeline/usage.jsonl` だけで、アプリを起動した日時と返信を送った日時を記録します (会話の内容は記録しません)。記録先のディレクトリは環境変数 `AGENT_TIMELINE_USAGE_DIR` で変えられます。記録先に書けない時も、記録せずに起動します。

## 開発

変更の検証方法は [AGENTS.md](AGENTS.md)、要件と制約は [documents/PROJECT.md](documents/PROJECT.md) にあります。

## 連絡先

bannzai.app@gmail.com

## ライセンス

[MIT](LICENSE)
