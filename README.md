# agent-timeline

An X-like timeline, on localhost, of what your Claude Code and Codex sessions are doing.

- **Timeline** — every session's prompts and answers flow into one feed, newest first
- **Threads** — open a post to read that session's conversation as a chain of replies
- **Reply to instruct** — reply in a thread and the text is sent to the tmux pane that runs the session

Status: under construction. Nothing is usable yet.

## Data handling

agent-timeline reads the session logs that Claude Code (`~/.claude/projects`) and Codex (`~/.codex/sessions`) already write on your machine. It listens on `127.0.0.1` only, stores no copy of the logs and sends nothing to any server. The only file it writes is `~/.agent-timeline/usage.jsonl`, which records when the app was started and when a reply was sent, without any conversation content.

## Development

See [AGENTS.md](AGENTS.md) for how changes are verified and [documents/PROJECT.md](documents/PROJECT.md) for requirements and constraints.

## Contact

bannzai.app@gmail.com
