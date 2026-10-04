# agent-timeline

手元で動いている Claude Code と Codex のセッションを、X のタイムライン風に眺める localhost の Web アプリ。

- **タイムライン**: 全セッションの指示と返答が、新しい順に 1 つのフィードに流れる
- **スレッド**: 投稿を開くと、そのセッションの会話が返信の連なりとして読める
- **返信で指示**: スレッドに返信すると、その文がセッションの動いている tmux の pane に送られる

状態: 開発中。まだ使える機能はありません。

## データの扱い

agent-timeline は、Claude Code (`~/.claude/projects`) と Codex (`~/.codex/sessions`) が手元に書いているセッションのログを読みます。待ち受けは `127.0.0.1` だけで、ログの写しを保存せず、どのサーバーにも送信しません。書き込むファイルは `~/.agent-timeline/usage.jsonl` だけで、アプリを起動した日時と返信を送った日時を記録します (会話の内容は記録しません)。

## 開発

変更の検証方法は [AGENTS.md](AGENTS.md)、要件と制約は [documents/PROJECT.md](documents/PROJECT.md) にあります。

## 連絡先

bannzai.app@gmail.com

## ライセンス

[MIT](LICENSE)
